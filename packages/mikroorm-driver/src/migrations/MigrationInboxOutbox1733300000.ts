import { Migration } from '@mikro-orm/migrations';
import { getNotifyTriggerSQL } from '../listener/postgresql-event-listener';

export class MigrationInboxOutbox1733300000 extends Migration {
  async up(): Promise<void> {
    const sql = getNotifyTriggerSQL();
    this.addSql(sql.createFunction);
    this.addSql(sql.createTrigger);
  }

  async down(): Promise<void> {
    const sql = getNotifyTriggerSQL();
    this.addSql(sql.dropTrigger);
    this.addSql(sql.dropFunction);
  }
}
