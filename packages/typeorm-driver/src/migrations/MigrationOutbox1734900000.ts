import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrationOutbox1734900000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE outbox_transport_event ADD COLUMN retry_count INT NOT NULL DEFAULT 0');
    await queryRunner.query("ALTER TABLE outbox_transport_event ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending'");
    await queryRunner.query('CREATE INDEX idx_outbox_transport_event_status ON outbox_transport_event (status)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_outbox_transport_event_status');
    await queryRunner.query('ALTER TABLE outbox_transport_event DROP COLUMN status');
    await queryRunner.query('ALTER TABLE outbox_transport_event DROP COLUMN retry_count');
  }
}
