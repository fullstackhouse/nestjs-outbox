import { Migration } from '@mikro-orm/migrations';

export class MigrationInboxOutbox1733300000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE OR REPLACE FUNCTION notify_inbox_outbox_event() RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('inbox_outbox_event', NEW.id::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    this.addSql(`
      CREATE TRIGGER inbox_outbox_event_notify
        AFTER INSERT ON inbox_outbox_transport_event
        FOR EACH ROW EXECUTE FUNCTION notify_inbox_outbox_event();
    `);
  }

  async down(): Promise<void> {
    this.addSql('DROP TRIGGER IF EXISTS inbox_outbox_event_notify ON inbox_outbox_transport_event;');
    this.addSql('DROP FUNCTION IF EXISTS notify_inbox_outbox_event();');
  }
}
