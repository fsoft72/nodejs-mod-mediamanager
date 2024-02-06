/*
 * This file has been generated by flow2code
 * See: https://flow.liwe.org
 */

import { ILRequest, ILResponse, LCback, ILiweConfig, ILError, ILiWE } from '../../liwe/types';
import { $l } from '../../liwe/locale';
import { system_permissions_register } from '../system/methods';

import {
	Media, MediaBind, MediaBindKeys, MediaFolder, MediaFolderKeys,
	MediaKeys, MediaTreeItem, MediaTreeItemKeys,
} from './types';

import _module_perms from './perms';

let _liwe: ILiWE = null;

const _ = ( txt: string, vals: any = null, plural = false ) => {
	return $l( txt, vals, plural, "mediamanager" );
};

const COLL_MM_MEDIAS = "mm_medias";
const COLL_MM_BINDINGS = "mm_bindings";
const COLL_MM_FOLDERS = "mm_folders";

/*=== f2c_start __file_header === */
import { adb_collection_init, adb_del_all_raw, adb_del_one, adb_find_all, adb_find_one, adb_record_add } from '../../liwe/db/arango';
import { system_domain_get_by_session } from '../system/methods';
import { SystemDomain } from '../system/types';
import { md5, mkid } from '../../liwe/utils';
import { ext, ext2mime } from '../../liwe/mimetype';
import * as fs from '../../liwe/fs';
import { module_config_load, upload_fullpath } from '../../liwe/liwe';
import { compress_image, mk_thumb } from '../../liwe/image';
import { ExifImage } from 'exif';
import { tag_obj } from '../tag/methods';
import sharp = require( 'sharp' );
import { perm_available } from '../../liwe/auth';
import { liwe_event_emit, LiWEEventResponse } from '../../liwe/events';
import { MM_EVENT_MEDIA_DELETE, MM_EVENT_MEDIA_READY } from './events';

const mm_cfg = module_config_load( 'mediamanager' );

const _create_root_folder = async ( req: ILRequest, domain: SystemDomain ): Promise<MediaFolder> => {
	const folder: MediaFolder = {
		id: `${ domain.code }-root`,
		domain: domain.code,
		name: "(root)",
		id_parent: null,
		subfolders: [],
		medias: [],
	};

	return await adb_record_add( req.db, COLL_MM_FOLDERS, folder );
};


const _get_root_folder = async ( req: ILRequest ): Promise<MediaFolder> => {
	const domain = await system_domain_get_by_session( req );
	const folder = await adb_find_one( req.db, COLL_MM_FOLDERS, { domain: domain.code, id: `${ domain.code }-root` } );

	if ( folder ) return folder;

	return await _create_root_folder( req, domain );
};

const _build_tree = async ( req: ILRequest, id: string ): Promise<any> => {
	const folder: MediaFolder = await adb_find_one( req.db, COLL_MM_FOLDERS, { id } );

	if ( !folder ) return null;

	const tree: any = {
		id: folder.id,
		name: folder.name,
		subfolders: [],
	};

	for ( const id of folder.subfolders ) {
		const subfolder = await _build_tree( req, id );
		if ( subfolder ) tree.subfolders.push( subfolder );
	}

	return tree;
};

const _resolve_folder = async ( req: ILRequest, id_folder: string, err: ILError ): Promise<MediaFolder> => {
	let folder: MediaFolder;
	err.message = "Folder not found";

	if ( !id_folder || id_folder == 'root' )
		folder = await _get_root_folder( req );
	else
		folder = await adb_find_one( req.db, COLL_MM_FOLDERS, { id: id_folder } );

	return folder;
};

const _prepare_media = ( req: ILRequest, folder: MediaFolder, filename: string, size: number, title: string ): Media => {
	if ( !title ) title = fs.basename( filename );

	filename = fs.sanitize( filename );

	// create a record inside the mm_medias collection
	const media: Media = {
		id: mkid( 'media' ),
		id_owner: req.user?.id || 'anonymous',
		domain: folder.domain,
		id_folder: folder.id,
		size,
		mimetype: ext2mime( ext( filename ) ),
		original_filename: filename,
		name: fs.basename( filename ),
		title,
		is_ready: false,
	};

	// id is   xxxx.bbbbb.ext
	// remove the .ext part and add a random number of 4 digits padded with 0
	const num = Math.floor( Math.random() * 10000 ).toString().padStart( 4, '0' );
	media.id = `${ media.id.split( "." ).slice( 0, -1 ).join( "." ) }.${ num }`;

	media.path = upload_fullpath( num );
	media.filename = `${ media.id }.${ ext( filename ) }`;
	media.abs_path = `${ media.path }/${ media.filename }`;
	media.thumbnail = `${ media.path }/thumbs/${ media.id }.jpg`;

	// Create the directory if it doesn't exist
	if ( !fs.exists( `${ media.path }/thumbs` ) ) fs.mkdir( `${ media.path }/thumbs` );

	return media;
};

const _media_is_ready = async ( req: ILRequest, media: Media ): Promise<Media> => {
	// create the thumbnail
	await mk_thumb( media.abs_path, media.thumbnail, req.cfg.upload.sizes.thumb || 400, 0 );

	// read metadata
	await _read_metadata( media );

	// if needed, we compress the original image
	if ( mm_cfg.compress_original && media.mimetype.startsWith( 'image/' ) && media.size > ( mm_cfg.compress_original_min_size * ( 1024 * 1024 ) ) ) {
		const tmp_fname = `${ media.abs_path }.tmp.jpg`;

		try {
			const res = await compress_image( media.abs_path, tmp_fname, mm_cfg.jpeg_quality || 80 );

			if ( res ) {
				const tmp_size = fs.fileSize( tmp_fname );
				if ( tmp_size < media.size ) {
					fs.move( tmp_fname, media.abs_path );
					media.size = tmp_size;
				}
			}
		} catch ( err ) {
			console.error( "=== RESIZE ORIG ERROR: ", err );
		}
	}

	await liwe_event_emit( req, MM_EVENT_MEDIA_READY, media );

	media.is_ready = true;

	_fix_media( media );

	return media;
};

const _read_metadata = async ( media: Media ): Promise<void> => {
	return new Promise( ( resolve, reject ) => {
		new ExifImage( { image: media.abs_path }, async ( err, exifData ) => {
			if ( exifData ) {
				delete ( exifData as any )[ 'userComment' ];
				// console.log( "=== EXIF: ", JSON.stringify( exifData, null, 4 ) );

				if ( Object.keys( exifData.gps ).length > 0 ) {
					const { GPSLatitude, GPSLongitude } = exifData.gps;
					if ( GPSLatitude?.length == 3 && GPSLongitude?.length == 3 ) {
						const latitude = GPSLatitude[ 0 ] + GPSLatitude[ 1 ] / 60 + GPSLatitude[ 2 ] / 3600;
						const longitude = GPSLongitude[ 0 ] + GPSLongitude[ 1 ] / 60 + GPSLongitude[ 2 ] / 3600;

						media.lat = latitude.toString();
						media.lng = longitude.toString();
					}
				}

				media.width = exifData.exif.ExifImageWidth;
				media.height = exifData.exif.ExifImageHeight;

				media.exif = exifData.image;
				media.creation = _convDate( exifData.exif.CreateDate );
				media.year = media.creation.getFullYear();
				media.month = media.creation.getMonth() + 1;

				media.orientation = exifData.image.Orientation;
			} else {
				// the media has no exif data, we try to get image width and height
				try {
					const metadata = await sharp( media.abs_path ).metadata();

					media.width = metadata.width;
					media.height = metadata.height;
				} catch ( err ) {
					console.log( "=== ERROR: ", err );
				}

			}

			return resolve();
		} );
	} );
};

// takes a date in this format: "2007:06:24 11:54:27"
// and returns a valid JavaScript date object
const _convDate = ( date: string ): Date => {
	if ( !date ) return new Date();

	const parts = date.split( " " );
	const d = parts[ 0 ].split( ":" );
	const t = parts[ 1 ].split( ":" );

	return new Date( parseInt( d[ 0 ] ), parseInt( d[ 1 ] ) - 1, parseInt( d[ 2 ] ), parseInt( t[ 0 ] ), parseInt( t[ 1 ] ), parseInt( t[ 2 ] ) );
};

// if some metadata is missing, try to fix it
const _fix_media = ( media: Media ): void => {
	if ( !media.creation ) {
		media.creation = new Date();
		media.year = media.creation.getFullYear();
		media.month = media.creation.getMonth() + 1;
	}

	if ( !media.orientation ) media.orientation = 1;
};

export const mm_get_folder_by_name = async ( req: ILRequest, name: string, id_parent?: string ): Promise<MediaFolder> => {
	const err = { message: "Folder not found" };
	const parent: MediaFolder = await _resolve_folder( req, id_parent, err );

	const folder = await adb_find_one( req.db, COLL_MM_FOLDERS, { name, id_parent: parent.id } );

	return folder;
};
/*=== f2c_end __file_header ===*/

// {{{ post_media_upload_chunk_start ( req: ILRequest, id_folder: string, filename: string, size: number, title?: string, tags?: string[], anonymous?: string, cback: LCBack = null ): Promise<string>
/**
 *
 * Use this to start a new chunked upload.
 * The chunked upload is used to upload very big files.
 * This call will instruct the server to receive a new chunked file.
 * During this call you have to provide the original `filename` and the whole upload `size` in bytes.
 * The endpoint will return the `id_upload` that must be used for the next chunked transfer calls.
 * If the payload contains the `anonymous` value, then the user doesn't need to be logged in to upload files.
 *
 * @param id_folder - The ID Folder where to upload the media [req]
 * @param filename - Original filename [req]
 * @param size - Complete file size in bytes [req]
 * @param title - The media title [opt]
 * @param tags - The media tags [opt]
 * @param anonymous - If it is set, you don't need permissions [opt]
 *
 * @return id_upload: string
 *
 */
export const post_media_upload_chunk_start = ( req: ILRequest, id_folder: string, filename: string, size: number, title?: string, tags?: string[], anonymous?: string, cback: LCback = null ): Promise<string> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start post_media_upload_chunk_start ===*/
		const err = { message: "Folder not found" };

		// if there is no anonymous flag, the user must be logged in and have the 'media.create' permission
		if ( !anonymous ) {
			if ( !perm_available( req?.user ?? {}, [ 'media.create' ] ) ) {
				err.message = _( "You don't have the permission to upload media" );
				return cback ? cback( err, null ) : reject( err );
			}
		} else {
			// if anonymous is present, we check it against the data being uploaded
			const d = md5( `${ filename }${ size }${ id_folder }` );
			if ( d != anonymous ) {
				err.message = _( "Invalid anonymous token" );
				return cback ? cback( err, null ) : reject( err );
			}
		}

		const folder: MediaFolder = await _resolve_folder( req, id_folder, err );
		if ( !folder ) return cback ? cback( err, null ) : reject( err );

		const media: Media = _prepare_media( req, folder, filename, size, title );

		// Create an empty file with the correct size if it doesn't exist
		if ( !fs.exists( media.abs_path ) ) fs.write( media.abs_path, Buffer.alloc( media.size ) );

		await tag_obj( req, tags, media, 'mediamanager' );

		await adb_record_add( req.db, COLL_MM_MEDIAS, media );

		return cback ? cback( null, media.id ) : resolve( media.id );
		/*=== f2c_end post_media_upload_chunk_start ===*/
	} );
};
// }}}

// {{{ post_media_upload_chunk_add ( req: ILRequest, id_upload: string, start: number, cback: LCBack = null ): Promise<number>
/**
 *
 * This call will add a new chunk to the file being uploaded.
 * In the query field you have to provide:
 * - `id_upload`:   the upload id you got with the `/media/upload/chunk/start` call
 * - `start`:  the start position of this chunk (in bytes)
 * In the `post` section, you have to provide an `application/octet-stream` of your binary chunk data.
 *
 * @param id_upload - The id_upload [req]
 * @param start - The starting point [req]
 *
 * @return bytes: number
 *
 */
export const post_media_upload_chunk_add = ( req: ILRequest, id_upload: string, start: number, cback: LCback = null ): Promise<number> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start post_media_upload_chunk_add ===*/
		const err = { message: "Upload not found" };
		let media: Media = await adb_find_one( req.db, COLL_MM_MEDIAS, { id: id_upload } );

		if ( !media ) return cback ? cback( err, null ) : reject( err );

		let bytes = 0;

		// Write the chunk to the file at the correct position
		const writeStream = fs.createWriteStream( media.abs_path, { start, flags: 'r+' } );
		req.on( 'data', ( chunk ) => {
			bytes += chunk.length;
			// console.log( "=== writing ...", chunk.length );
			writeStream.write( chunk );
		} );
		req.on( 'end', async () => {
			// console.log( "=== ending ..." );
			writeStream.end();
			// console.log( "=== START: ", start, "BYTES: ", bytes, "TOTAL: ", media.size, "COMPLETED: ", ( start + bytes == media.size ) );
			if ( start + bytes == media.size ) {
				media = await _media_is_ready( req, media );

				await adb_record_add( req.db, COLL_MM_MEDIAS, media );
			}
			return cback ? cback( null, bytes ) : resolve( bytes );
		} );
		/*=== f2c_end post_media_upload_chunk_add ===*/
	} );
};
// }}}

// {{{ post_media_folder_create ( req: ILRequest, id_parent: string, name: string, cback: LCBack = null ): Promise<MediaFolder>
/**
 *
 * Creates a new folder
 *
 * @param id_parent - The parent folder [req]
 * @param name - The folder name [req]
 *
 * @return folder: MediaFolder
 *
 */
export const post_media_folder_create = ( req: ILRequest, id_parent: string, name: string, cback: LCback = null ): Promise<MediaFolder> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start post_media_folder_create ===*/
		const err = { message: "Folder not found" };
		const domain = await system_domain_get_by_session( req );
		const parent: MediaFolder = await _resolve_folder( req, id_parent, err );

		if ( !parent ) return cback ? cback( err, null ) : reject( err );

		// check if the folder already exists
		const fold = await mm_get_folder_by_name( req, name, parent.id );
		if ( fold ) {
			err.message = "Folder already exists";
			return cback ? cback( err, null ) : reject( err );
		}

		const folder: MediaFolder = {
			id: mkid( 'folder' ),
			domain: domain.code,
			name,
			id_parent,
			subfolders: [],
			medias: [],
		};

		// add the new folder to the parent subfolders
		parent.subfolders.push( folder.id );
		await adb_record_add( req.db, COLL_MM_FOLDERS, parent );

		// save the new folder
		await adb_record_add( req.db, COLL_MM_FOLDERS, folder );

		return cback ? cback( null, folder ) : resolve( folder );
		/*=== f2c_end post_media_folder_create ===*/
	} );
};
// }}}

// {{{ patch_media_folder_rename ( req: ILRequest, id_folder: string, name: string, cback: LCBack = null ): Promise<MediaFolder>
/**
 *
 * Renames a folder
 *
 * @param id_folder -  [req]
 * @param name - The new folder name [req]
 *
 * @return folder: MediaFolder
 *
 */
export const patch_media_folder_rename = ( req: ILRequest, id_folder: string, name: string, cback: LCback = null ): Promise<MediaFolder> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start patch_media_folder_rename ===*/
		const err = { message: "Folder not found" };
		const folder: MediaFolder = await adb_find_one( req.db, COLL_MM_FOLDERS, { id: id_folder } );

		if ( !folder ) return cback ? cback( err, null ) : reject( err );

		folder.name = name;

		await adb_record_add( req.db, COLL_MM_FOLDERS, folder );

		return cback ? cback( null, folder ) : resolve( folder );
		/*=== f2c_end patch_media_folder_rename ===*/
	} );
};
// }}}

// {{{ delete_media_folder_delete ( req: ILRequest, id_folder: string, cback: LCBack = null ): Promise<boolean>
/**
 *
 * This endpoint deletes the provided folder along with all the subfolders and all the media contained.
 *
 * @param id_folder - The ID folder to delete [req]
 *
 * @return ok: boolean
 *
 */
export const delete_media_folder_delete = ( req: ILRequest, id_folder: string, cback: LCback = null ): Promise<boolean> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start delete_media_folder_delete ===*/
		const domain = await system_domain_get_by_session( req );
		const err = { message: "Folder not found" };
		const folder: MediaFolder = await adb_find_one( req.db, COLL_MM_FOLDERS, { domain: domain.code, id: id_folder } );

		if ( !folder ) return cback ? cback( err, null ) : reject( err );

		// delete all the subfolders
		for ( const id of folder.subfolders ) {
			await delete_media_folder_delete( req, id );
		}

		// list all the medias
		const medias: Media[] = await adb_find_all( req.db, COLL_MM_MEDIAS, { domain: domain.code, id_folder: folder.id } );
		if ( medias.length ) await delete_media_delete_items( req, medias.map( m => m.id ) );

		// get the parent folder
		const parent: MediaFolder = await adb_find_one( req.db, COLL_MM_FOLDERS, { domain: domain.code, id: folder.id_parent } );

		// if the parent exists, remove the folder from the subfolders
		if ( parent ) {
			parent.subfolders = parent.subfolders.filter( id => id != folder.id );
			await adb_record_add( req.db, COLL_MM_FOLDERS, parent );
		}

		// delete the folder
		await adb_del_one( req.db, COLL_MM_FOLDERS, { id: id_folder } );

		return cback ? cback( null, true ) : resolve( true );
		/*=== f2c_end delete_media_folder_delete ===*/
	} );
};
// }}}

// {{{ get_media_folder_root ( req: ILRequest, cback: LCBack = null ): Promise<MediaFolder>
/**
 *
 * Returns the root folder (related to the user `domain`)
 *
 *
 * @return folder: MediaFolder
 *
 */
export const get_media_folder_root = ( req: ILRequest, cback: LCback = null ): Promise<MediaFolder> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start get_media_folder_root ===*/
		const folder: MediaFolder = await _get_root_folder( req );

		return cback ? cback( null, folder ) : resolve( folder );
		/*=== f2c_end get_media_folder_root ===*/
	} );
};
// }}}

// {{{ get_media_list ( req: ILRequest, id_folders?: string[], cback: LCBack = null ): Promise<Media[]>
/**
 *
 * This endpoints can returns all elements of the specified `id_folder`.
 * If `id_folder` is not specified, all media are returned.
 *
 * @param id_folders - The ID Folders we want media from [opt]
 *
 * @return medias: Media
 *
 */
export const get_media_list = ( req: ILRequest, id_folders?: string[], cback: LCback = null ): Promise<Media[]> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start get_media_list ===*/
		const domain = await system_domain_get_by_session( req );
		if ( !id_folders || id_folders.length == 0 ) id_folders = undefined;
		if ( id_folders && id_folders.length && id_folders[ 0 ] == 'default-root' ) id_folders = undefined;

		let id_folder = undefined;
		if ( id_folders && id_folders.length ) id_folder = { mode: 'in', val: [ ...id_folders ] };

		const medias: Media[] = await adb_find_all( req.db, COLL_MM_MEDIAS, { domain: domain.code, id_folder }, MediaKeys );

		return cback ? cback( null, medias ) : resolve( medias );
		/*=== f2c_end get_media_list ===*/
	} );
};
// }}}

// {{{ get_media_get ( req: ILRequest, id: string, cback: LCBack = null ): Promise<Media>
/**
 *
 * @param id - The media ID [req]
 *
 * @return media: Media
 *
 */
export const get_media_get = ( req: ILRequest, id: string, cback: LCback = null ): Promise<Media> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start get_media_get ===*/
		const err = { message: "Media not found" };
		const media: Media = await adb_find_one( req.db, COLL_MM_MEDIAS, { id } );

		if ( !media ) {
			req.res.status( 404 ).send( err );
			return cback ? cback( err, null ) : reject( err );
		}

		return cback ? cback( null, media ) : resolve( media );
		/*=== f2c_end get_media_get ===*/
	} );
};
// }}}

// {{{ get_media_folders_tree ( req: ILRequest, id_folder?: string, cback: LCBack = null ): Promise<MediaFolder>
/**
 *
 * Returns a tree of folders starting from the `id_folder` provided.
 * If not `id_folder` is provided, the `root` folder will be used.
 * The tree returned will contain all folders and subfolders, but not the files.
 *
 * @param id_folder - The starting ID folder [opt]
 *
 * @return tree: MediaFolder
 *
 */
export const get_media_folders_tree = ( req: ILRequest, id_folder?: string, cback: LCback = null ): Promise<MediaFolder> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start get_media_folders_tree ===*/
		const err = { message: "Folder not found" };
		let folder: any;

		if ( !id_folder || id_folder == 'root' )
			folder = await _get_root_folder( req );
		else
			folder = await adb_find_one( req.db, COLL_MM_FOLDERS, { id: id_folder } );

		if ( !folder ) return cback ? cback( err, null ) : reject( err );

		const tree = await _build_tree( req, folder.id );

		return cback ? cback( null, tree ) : resolve( tree );
		/*=== f2c_end get_media_folders_tree ===*/
	} );
};
// }}}

// {{{ delete_media_delete_items ( req: ILRequest, medias: string[], cback: LCBack = null ): Promise<number>
/**
 *
 * This endpoint deletes from the filesystem all the items specified inside the `medias`.\
 * Each item specified is the `id` of a media item
 *
 * @param medias - An array of ID media to be deleted [req]
 *
 * @return deleted: number
 *
 */
export const delete_media_delete_items = ( req: ILRequest, medias: string[], cback: LCback = null ): Promise<number> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start delete_media_delete_items ===*/
		let res: LiWEEventResponse;
		const domain = await system_domain_get_by_session( req );
		const medias_deleted: Media[] = [];
		const medias_to_delete: Media[] = await adb_find_all( req.db, COLL_MM_MEDIAS,
			{
				domain: domain.code,
				id: { mode: 'in', value: medias }
			}
		);

		if ( medias_to_delete.length == 0 )
			return cback ? cback( null, 0 ) : resolve( 0 );

		for ( const media of medias_to_delete ) {
			res = await liwe_event_emit( req, MM_EVENT_MEDIA_DELETE, { media } );
			if ( res.length && res.reduce( ( acc, val ) => acc + ( val.skip ? 1 : 0 ), 0 ) != 0 ) continue;

			medias_deleted.push( media );

			fs.rm( media.abs_path );
			fs.rm( media.thumbnail );
		}

		// delete the records from the database
		await adb_del_all_raw( req.db, COLL_MM_MEDIAS, medias_deleted );

		return cback ? cback( null, medias_deleted.length ) : resolve( medias_deleted.length );
		/*=== f2c_end delete_media_delete_items ===*/
	} );
};
// }}}

// {{{ post_media_upload ( req: ILRequest, title?: string, module?: string, id_folder?: string, tags?: string[], cback: LCBack = null ): Promise<Media[]>
/**
 *
 * This method allows the upload of one or more files, using the *classical* way of uploading of `POST` files.
 *
 * @param title - The media title [opt]
 * @param module - The module the file belongs to [opt]
 * @param id_folder - Destination Folder id [opt]
 * @param tags - File tags [opt]
 *
 * @return media: Media
 *
 */
export const post_media_upload = ( req: ILRequest, title?: string, module?: string, id_folder?: string, tags?: string[], cback: LCback = null ): Promise<Media[]> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start post_media_upload ===*/
		const err = { message: "No files uploaded" };
		const keys = Object.keys( req.files );

		if ( keys.length == 0 )
			return cback ? cback( err, null ) : reject( err );

		const domain = await system_domain_get_by_session( req );
		const folder: MediaFolder = await _resolve_folder( req, id_folder, err );
		const res: Media[] = [];

		if ( !folder ) return cback ? cback( err, null ) : reject( err );


		await Promise.all( keys.map( async ( key ) => {
			const file = req.files[ key ];

			if ( !title ) title = file.name;

			const media: Media = _prepare_media( req, folder, file.name, file.size, title );

			// console.log( "=== FILE: ", key, file, media );

			// move the tmp file to the correct location
			fs.move( file.tempFilePath, media.abs_path );

			await tag_obj( req, tags, media, 'mediamanager' );

			await _media_is_ready( req, media );

			// add the media to the database
			await adb_record_add( req.db, COLL_MM_MEDIAS, media, MediaKeys );

			res.push( media );
		} ) );

		return cback ? cback( null, res ) : resolve( res );
		/*=== f2c_end post_media_upload ===*/
	} );
};
// }}}

// {{{ get_media_search ( req: ILRequest, title?: string, name?: string, type?: string, tags?: string[], year?: number, skip: number = 0, rows: number = 50, cback: LCBack = null ): Promise<Media[]>
/**
 *
 * Performs a query for one or more of the given fields
 *
 * @param title - Media title [opt]
 * @param name - Media name [opt]
 * @param type - Media type [opt]
 * @param tags - Media tags [opt]
 * @param year - Media creation year [opt]
 * @param skip - Pagination start [opt]
 * @param rows - How many rows to return [opt]
 *
 * @return medias: Media
 *
 */
export const get_media_search = ( req: ILRequest, title?: string, name?: string, type?: string, tags?: string[], year?: number, skip: number = 0, rows: number = 50, cback: LCback = null ): Promise<Media[]> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start get_media_search ===*/
		const medias: Media[] = await adb_find_all( req.db, COLL_MM_MEDIAS, { title: { mode: 'like', value: title }, name, type, tags, year }, MediaKeys, {
			skip, rows,
			sort: [ { field: 'created', desc: -1 } ]
		} );

		return cback ? cback( null, medias ) : resolve( medias );
		/*=== f2c_end get_media_search ===*/
	} );
};
// }}}

// {{{ get_media_get_latest ( req: ILRequest, skip: number = 0, rows: number = 50, cback: LCBack = null ): Promise<Media[]>
/**
 *
 * @param skip - The starting point [opt]
 * @param rows - How many items to retrieve [opt]
 *
 * @return medias: Media
 *
 */
export const get_media_get_latest = ( req: ILRequest, skip: number = 0, rows: number = 50, cback: LCback = null ): Promise<Media[]> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start get_media_get_latest ===*/
		const medias: Media[] = await adb_find_all( req.db, COLL_MM_MEDIAS, {}, MediaKeys, { skip, rows, sort: [ { field: "created", desc: -1 } ] } );

		return cback ? cback( null, medias ) : resolve( medias );
		/*=== f2c_end get_media_get_latest ===*/
	} );
};
// }}}

// {{{ patch_media_meta_update ( req: ILRequest, id: string, title?: string, tags?: string[], cback: LCBack = null ): Promise<Media>
/**
 *
 * Updates the media metadata
 *
 * @param id - Media id [req]
 * @param title - Media title [opt]
 * @param tags - Media tags [opt]
 *
 * @return media: Media
 *
 */
export const patch_media_meta_update = ( req: ILRequest, id: string, title?: string, tags?: string[], cback: LCback = null ): Promise<Media> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start patch_media_meta_update ===*/
		const err = { message: _( "Media not found" ) };
		const media: Media = await adb_find_one( req.db, COLL_MM_MEDIAS, { id } );

		if ( !media ) return cback ? cback( err, null ) : reject( err );

		if ( title ) media.title = title;
		if ( tags ) {
			media.tags = [];
			await tag_obj( req, tags, media, 'mediamanager' );
		}

		await adb_record_add( req.db, COLL_MM_MEDIAS, media );

		return cback ? cback( null, media ) : resolve( media );
		/*=== f2c_end patch_media_meta_update ===*/
	} );
};
// }}}

// {{{ media_get_multi ( medias?: string[], cback: LCBack = null ): Promise<Media[]>
/**
 *
 * Retrieve all media info by the given list of IDs
 *
 * @param medias - Array of ID medias [opt]
 *
 * @return : Media
 *
 */
export const media_get_multi = ( medias?: string[], cback: LCback = null ): Promise<Media[]> => {
	return new Promise( async ( resolve, reject ) => {
		/*=== f2c_start media_get_multi ===*/
		const meds: Media[] = await adb_find_all( _liwe.db, COLL_MM_MEDIAS, { id: { mode: 'in', value: medias } }, MediaKeys );

		return cback ? cback( null, meds ) : resolve( meds );
		/*=== f2c_end media_get_multi ===*/
	} );
};
// }}}

// {{{ mediamanager_db_init ( liwe: ILiWE, cback: LCBack = null ): Promise<boolean>
/**
 *
 * Initializes the module's database
 *
 * @param liwe - The Liwe object [req]
 *
 * @return : boolean
 *
 */
export const mediamanager_db_init = ( liwe: ILiWE, cback: LCback = null ): Promise<boolean> => {
	return new Promise( async ( resolve, reject ) => {
		_liwe = liwe;

		system_permissions_register( 'mediamanager', _module_perms );

		await adb_collection_init( liwe.db, COLL_MM_MEDIAS, [
			{ type: "persistent", fields: [ "id" ], unique: true },
			{ type: "persistent", fields: [ "domain" ], unique: false },
			{ type: "persistent", fields: [ "id_owner" ], unique: false },
			{ type: "persistent", fields: [ "id_folder" ], unique: false },
			{ type: "persistent", fields: [ "title" ], unique: false },
			{ type: "persistent", fields: [ "is_ready" ], unique: false },
			{ type: "persistent", fields: [ "tags[*]" ], unique: false },
			{ type: "persistent", fields: [ "year" ], unique: false },
			{ type: "persistent", fields: [ "month" ], unique: false },
			{ type: "persistent", fields: [ "creation" ], unique: false },
			{ type: "persistent", fields: [ "orientation" ], unique: false },
		], { drop: false } );

		await adb_collection_init( liwe.db, COLL_MM_BINDINGS, [
			{ type: "persistent", fields: [ "id" ], unique: true },
		], { drop: false } );

		await adb_collection_init( liwe.db, COLL_MM_FOLDERS, [
			{ type: "persistent", fields: [ "id" ], unique: true },
			{ type: "persistent", fields: [ "domain" ], unique: false },
		], { drop: false } );

		/*=== f2c_start mediamanager_db_init ===*/

		/*=== f2c_end mediamanager_db_init ===*/
	} );
};
// }}}


