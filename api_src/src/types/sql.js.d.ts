declare module 'sql.js' {
    interface Database {
        run(sql: string, params?: any[]): void;
        exec(sql: string, params?: any[]): { columns: string[]; values: any[][] }[];
        export(): Uint8Array;
        close(): void;
    }

    interface SqlJsStatic {
        Database: new (data?: ArrayLike<number>) => Database;
    }

    function initSqlJs(): Promise<SqlJsStatic>;
    export default initSqlJs;
    export type { Database, SqlJsStatic };
}
