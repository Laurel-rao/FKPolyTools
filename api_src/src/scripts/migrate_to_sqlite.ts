/**
 * 数据迁移脚本 - 将 JSON 文件迁移到 sql.js SQLite 数据库
 */

import * as fs from 'fs';
import * as path from 'path';
import { initDb, getDb, saveDb } from '../db/index.js';

const DATA_DIR = path.resolve(process.cwd(), '../datas');
const WHALES_DIR = path.join(DATA_DIR, 'whales');
const WATCHED_FILE = path.join(DATA_DIR, 'watched_addresses.json');

async function migrate() {
    console.log('Starting migration to sql.js SQLite...');
    const start = Date.now();

    // 初始化数据库
    await initDb();
    const db = getDb();

    // 1. 迁移监控地址
    try {
        if (fs.existsSync(WATCHED_FILE)) {
            const watchedData = JSON.parse(fs.readFileSync(WATCHED_FILE, 'utf-8'));
            if (Array.isArray(watchedData)) {
                console.log(`Migrating ${watchedData.length} watched addresses...`);

                const now = Date.now();
                for (const address of watchedData) {
                    db.run(
                        'INSERT OR IGNORE INTO watched (address, added_at) VALUES (?, ?)',
                        [address.toLowerCase(), now]
                    );
                }
                console.log(`✅ Migrated watched addresses.`);
            }
        } else {
            console.log('⚠️ Watched addresses file not found, skipping.');
        }
    } catch (error) {
        console.error('❌ Error migrating watched addresses:', error);
    }

    // 2. 迁移鲸鱼数据
    try {
        if (fs.existsSync(WHALES_DIR)) {
            const files = fs.readdirSync(WHALES_DIR).filter(f => f.endsWith('.json'));
            console.log(`Found ${files.length} whale data files.`);

            let count = 0;
            for (const file of files) {
                const filePath = path.join(WHALES_DIR, file);
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    // 验证 JSON 有效性
                    JSON.parse(content);

                    const address = path.basename(file, '.json').toLowerCase();
                    const stat = fs.statSync(filePath);
                    const lastUpdated = Math.floor(stat.mtimeMs);

                    db.run(
                        'INSERT OR REPLACE INTO whales (address, data, last_updated) VALUES (?, ?, ?)',
                        [address, content, lastUpdated]
                    );
                    count++;

                    if (count % 100 === 0) {
                        console.log(`  Processed ${count} files...`);
                    }
                } catch (err) {
                    console.error(`  ❌ Failed to migrate ${file}:`, err);
                }
            }
            console.log(`✅ Migrated ${count} whale profiles.`);
        } else {
            console.log('⚠️ Whales directory not found, skipping.');
        }
    } catch (error) {
        console.error('❌ Error migrating whale data:', error);
    }

    // 保存数据库
    saveDb();

    console.log(`Migration completed in ${(Date.now() - start) / 1000}s.`);
    console.log(`Database saved to: ${path.join(DATA_DIR, 'whales.db')}`);
}

migrate().catch(console.error);
