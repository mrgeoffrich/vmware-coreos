import * as https from 'https';
import * as fs from 'fs';
import { ITaskManager } from './taskManager';

class DownloadPromiseReturn {
    fileDownloadComplete: boolean;
    bytesDownloaded: number;
    fileExisted: boolean;
    constructor() {
        this.fileDownloadComplete = false;
        this.bytesDownloaded = 0;
        this.fileExisted = false;
    }
}

export function downloadHttpsFileProgress(taskManager: ITaskManager, url: string, filePath: string, overwrite = false) {
    return new Promise<DownloadPromiseReturn>((resolve, reject) => {
        let promiseReturn = new DownloadPromiseReturn();
        if (fs.existsSync(filePath)) {
            promiseReturn.fileExisted = true;
        }

        if (!overwrite && promiseReturn.fileExisted) {
            // Don't overwrite the file, just exit quietly
            resolve(promiseReturn);
        }
        else {
            var file = fs.createWriteStream(filePath);

            var request = https.get(url, (response) => {

                if (response.statusCode !== 200) { // check if response is success
                    reject('Response status was ' + response.statusCode);
                }

                var len = parseInt(response.headers['content-length'], 10);
                taskManager.StartProgress(len);

                response.on('data', (chunk) => {
                    taskManager.TickStep(chunk.length);
                    promiseReturn.bytesDownloaded += chunk.length;
                });

                response.pipe(file);

                file.on('finish', () => {
                    promiseReturn.fileDownloadComplete = true;
                    resolve(promiseReturn);
                });
            });

            request.on('error', (err) => {
                fs.unlink(filePath);
                reject(err);
            });

            file.on('error', (err) => { // Handle errors
                fs.unlink(filePath); // Delete the file async. (But we don't check the result)
                reject(err);
            });
        }
    });
};