import type { DatabaseConnection } from '../Database.js';

export const migration = {
  version: 7,
  name: 'drop_openrouter_key',
  up: (db: DatabaseConnection): void => {
    db.exec(`ALTER TABLE user_keys DROP COLUMN openrouter_key;`);
  },
};
