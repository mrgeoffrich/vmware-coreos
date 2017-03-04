export interface ValidationCommandDefinition {
    Roles: string[];
    Command: string;
    Type: string;
    Value: string;
    Description: string;
}
export interface ValidationSpecDefinition {
    ValidationCommands: ValidationCommandDefinition[];
}