import { Migration } from '@mikro-orm/migrations';

export class MigrationOutbox1734900000 extends Migration {
  async up(): Promise<void> {
    this.addSql('ALTER TABLE outbox_transport_event ADD COLUMN retry_count INT NOT NULL DEFAULT 0');
    this.addSql("ALTER TABLE outbox_transport_event ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending'");
    this.addSql('CREATE INDEX idx_outbox_transport_event_status ON outbox_transport_event (status)');
    this.addSql('ALTER TABLE outbox_transport_event RENAME COLUMN ready_to_retry_after TO attempt_at');
  }

  async down(): Promise<void> {
    this.addSql('ALTER TABLE outbox_transport_event RENAME COLUMN attempt_at TO ready_to_retry_after');
    this.addSql('DROP INDEX IF EXISTS idx_outbox_transport_event_status');
    this.addSql('ALTER TABLE outbox_transport_event DROP COLUMN status');
    this.addSql('ALTER TABLE outbox_transport_event DROP COLUMN retry_count');
  }
}
