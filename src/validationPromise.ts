import * as ssh2 from 'ssh2';

export interface ValidateReturnValue {
    Output: string;
    ErrorOutput: string;
}

export function validate(ipAddress: string, username: string, password: string, command: string): Promise<ValidateReturnValue> {
    return new Promise<ValidateReturnValue>((resolve, reject) => {
        let Client = ssh2.Client;
        let returnVal = '';
        let returnErrorVal = '';

        var conn = new Client();
        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    reject(err);
                };
                stream.on('close', (code, signal) => {
                    conn.end();
                    resolve({ Output: returnVal, ErrorOutput: returnErrorVal });
                }).on('data', (data) => {
                    returnVal = returnVal + data;
                }).stderr.on('data', (data) => {
                    returnErrorVal = returnErrorVal + data;
                });
            });
        }).connect({
            host: ipAddress,
            port: 22,
            username: username,
            password: password
        });
        conn.on('error', (err) => {
            reject(err);
        });
    });

}