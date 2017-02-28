import * as fs from 'fs';
import * as tarfs from 'tar-fs';
import { ITaskManager } from './taskManager';

export async function untarFile(taskManager: ITaskManager, filename: string, targetfolder: string, includeProgress: boolean): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        var readStream = fs.createReadStream(filename);
        var stats = fs.statSync(filename);
        var fileSizeInBytes = stats['size'];

        if (includeProgress) {
            taskManager.StartProgress(fileSizeInBytes);
        }

        readStream.on('data', (chunk) => {
            if (includeProgress) { taskManager.TickStep(chunk.length); };
        });

        readStream.on('end', () => {
            resolve(true);
        });

        readStream.on('error', (err) => {
            reject(err);
        });

        readStream.pipe(tarfs.extract(targetfolder));
    });
}