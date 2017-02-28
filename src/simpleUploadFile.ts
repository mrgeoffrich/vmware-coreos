import * as https from 'https';
import * as fs from 'fs';
import * as url from 'url';

export function uploadFile(filePath: string, uploadUrl: string) {
    return new Promise((resolve, reject) => {
        let obj = url.parse(uploadUrl);
        fs.createReadStream(filePath).pipe(https.request({
            hostname: obj.hostname,
            method: 'PUT',
            path: obj.path,
            port: parseInt(obj.port)
        }, (res) => {
            if (res.statusCode === 200) {
                resolve();
            } else {
                reject();
            }
        }));
    });
}