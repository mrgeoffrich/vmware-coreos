import * as fs from 'fs';

export class Credentials {
    Host: string;
    Username: string;
    Password: string;

    constructor(filename: string) {
        if (!fs.existsSync(filename)) {
            throw 'Credentials file .credentials.json not found.';
        }
        let contents = fs.readFileSync(filename);
        let jsonContent = JSON.parse(contents.toString());
        this.Host = jsonContent['host'];
        this.Username = jsonContent['username'];
        this.Password = jsonContent['password'];
    }
}