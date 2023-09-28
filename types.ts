/* Types file generated by flow2code */

/*=== f2c_start __file ===*/

/*=== f2c_end __file ===*/
/** Media */
export interface Media {
	/** the main id field */
	id: string;
	domain?: string;
	/** The user id that uploaded this media */
	id_owner?: string;
	/** The folder containing this media */
	id_folder?: string;
	/** Media title */
	title?: string;
	/** Upload file name */
	name?: string;
	/** The original uploaded file name  */
	original_filename?: string;
	/** The file mimetype  */
	mimetype?: string;
	/** The path of the generated thumbnail */
	thumbnail?: string;
	/** The uploaded path */
	path?: string;
	/** The uploaded filename  */
	filename?: string;
	/** The absolute path and filename  */
	abs_path?: string;
	/** File size in bytes */
	size?: number;
	/** File Extension  */
	ext?: string;
	/** Flag T/F that tells if the media is ready */
	is_ready?: boolean;
	/** MD5 file checksum */
	md5?: string;
	/** tags for this media */
	tags?: string[];
	/** Latitude */
	lat?: string;
	/** Longitude */
	lng?: string;
	/** Width in pixels */
	width?: number;
	/** Height in pixels */
	height?: number;
	/** Year of creation of the media */
	year?: number;
	/** Month of creation of the media */
	month?: number;
	/** Date of creation of the media */
	creation?: Date;
	/** If a photo is vertical or horizontal */
	orientation?: number;
	/** Image EXIF metadata */
	exif?: any;
}

export const MediaKeys = {
	'id': { type: 'string', priv: false },
	'domain': { type: 'string', priv: false },
	'id_owner': { type: 'string', priv: false },
	'id_folder': { type: 'string', priv: false },
	'title': { type: 'string', priv: false },
	'name': { type: 'string', priv: false },
	'original_filename': { type: 'string', priv: false },
	'mimetype': { type: 'string', priv: false },
	'thumbnail': { type: 'string', priv: false },
	'path': { type: 'string', priv: false },
	'filename': { type: 'string', priv: false },
	'abs_path': { type: 'string', priv: false },
	'size': { type: 'number', priv: false },
	'ext': { type: 'string', priv: false },
	'is_ready': { type: 'boolean', priv: false },
	'md5': { type: 'string', priv: false },
	'tags': { type: 'string[]', priv: false },
	'lat': { type: 'string', priv: false },
	'lng': { type: 'string', priv: false },
	'width': { type: 'number', priv: false },
	'height': { type: 'number', priv: false },
	'year': { type: 'number', priv: false },
	'month': { type: 'number', priv: false },
	'creation': { type: 'Date', priv: false },
	'orientation': { type: 'number', priv: false },
	'exif': { type: 'any', priv: false },
};

/** MediaBind */
export interface MediaBind {
	/** the main id field */
	id: string;
	id_media?: string;
	id_object?: string;
	module?: string;
}

export const MediaBindKeys = {
	'id': { type: 'string', priv: false },
	'id_media': { type: 'string', priv: false },
	'id_object': { type: 'string', priv: false },
	'module': { type: 'string', priv: false },
};

/** MediaFolder */
export interface MediaFolder {
	/** the main id field */
	id: string;
	/** The domain */
	domain?: string;
	/** The parent folder */
	id_parent?: string;
	name?: string;
	/** IDs of Media Folders */
	subfolders?: string[];
	/** IDs of Medias in this folder */
	medias?: string[];
}

export const MediaFolderKeys = {
	'id': { type: 'string', priv: false },
	'domain': { type: 'string', priv: false },
	'id_parent': { type: 'string', priv: false },
	'name': { type: 'string', priv: false },
	'subfolders': { type: 'string[]', priv: false },
	'medias': { type: 'string[]', priv: false },
};

/** MediaTreeItem */
export interface MediaTreeItem {
	/** the main id field */
	id: string;
	id_parent?: string;
	name?: string;
	subfolders?: MediaTreeItem[];
}

export const MediaTreeItemKeys = {
	'id': { type: 'string', priv: false },
	'id_parent': { type: 'string', priv: false },
	'name': { type: 'string', priv: false },
	'subfolders': { type: 'MediaTreeItem[]', priv: false },
};

