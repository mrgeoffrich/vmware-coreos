import * as https from 'https';
import * as fs from 'fs';
import * as url from 'url';
import { ITaskManager } from './taskManager';

class UploadPromiseReturn {
    fileUploadComplete: boolean;
    bytesUploaded: number;
    constructor() {
        this.fileUploadComplete = false;
        this.bytesUploaded = 0;
    }
}

export async function uploadHttpsFileProgress(taskManager: ITaskManager, uploadUrl: string, filePath: string, authCookie: string, userAgent: string, includeProgress: boolean) {
    return new Promise<UploadPromiseReturn>((resolve, reject) => {
        let promiseReturn = new UploadPromiseReturn();
        if (!fs.existsSync(filePath)) {
            reject('File does not exist to upload.');
        }
        else {
            var fileReadStream = fs.createReadStream(filePath);
            var stats = fs.statSync(filePath);
            var fileSizeInBytes = stats['size'];
            var parsedUrl = url.parse(uploadUrl);

            var options = {
                host: parsedUrl.host,
                path: parsedUrl.path,
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': fileSizeInBytes,
                    'Cookie': 'vmware_cgi_ticket=' + authCookie,
                    'User-Agent': userAgent
                }
            };

            if (includeProgress) {
                taskManager.StartProgress(fileSizeInBytes);
            }

            var request = https.request(options, (response) => {
                if (response.statusCode !== 201 && response.statusCode !== 200) { // check if response is success
                    reject('Response status was ' + response.statusCode);
                }
            });

            request.on('error', (err) => {
                fileReadStream.close();
                reject(err);
            });

            fileReadStream.on('data', (chunk) => {
                if (includeProgress){
                    taskManager.TickStep(chunk.length);
                }
            });

            fileReadStream.on('error', (err) => { // Handle errors
                fileReadStream.close();
                reject(err);
            });

            fileReadStream.on('end', () => {
                promiseReturn.fileUploadComplete = true;
                promiseReturn.bytesUploaded = fileSizeInBytes;
                request.end();
                resolve(promiseReturn);
            });

            fileReadStream.pipe(request);
        }
    });
};