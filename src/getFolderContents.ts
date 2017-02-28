import * as https from 'https';
import * as url from 'url';

export function checkDatastoreFileExists(uploadUrl: string, authCookie: string, userAgent: string) {
    return new Promise<boolean>((resolve, reject) => {

        var parsedUrl = url.parse(uploadUrl);

        var options = {
            host: parsedUrl.host,
            path: parsedUrl.path,
            method: 'HEAD',
            headers: {
                'Cookie': 'vmware_cgi_ticket=' + authCookie,
                'User-Agent': userAgent
            }
        };

        var request = https.request(options, (response) => {

            let rawData = '';

            response.on('data', (chunk) => {
                rawData += chunk;
            });

            response.on('end', () => {
                if (response.statusCode === 200) {
                    resolve(true);
                }
                else if (response.statusCode === 404) {
                    resolve(false);
                } else {
                    reject(`Error checking file exists. Response: ${response.statusCode}`);
                }
            });
        });

        request.on('error', (e) => {
            console.error(e);
        });

        request.end();
    });
};