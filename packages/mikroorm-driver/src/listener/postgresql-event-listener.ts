import { MikroORM } from '@mikro-orm/core';
import { Logger } from '@nestjs/common';
import { EventListener } from '@nestixis/nestjs-inbox-outbox';
import { Client, Notification } from 'pg';
import { Observable, Subject } from 'rxjs';

export const DEFAULT_POSTGRESQL_EVENT_CHANNEL = 'inbox_outbox_event';

export interface PostgreSQLEventListenerOptions {
  reconnectDelayMs?: number;
  channelName?: string;
}

export function getNotifyTriggerSQL(channelName: string = DEFAULT_POSTGRESQL_EVENT_CHANNEL): {
  createFunction: string;
  createTrigger: string;
  dropTrigger: string;
  dropFunction: string;
} {
  return {
    createFunction: `
      CREATE OR REPLACE FUNCTION notify_inbox_outbox_event() RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('${channelName}', NEW.id::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `,
    createTrigger: `
      CREATE TRIGGER inbox_outbox_event_notify
        AFTER INSERT ON inbox_outbox_transport_event
        FOR EACH ROW EXECUTE FUNCTION notify_inbox_outbox_event();
    `,
    dropTrigger: 'DROP TRIGGER IF EXISTS inbox_outbox_event_notify ON inbox_outbox_transport_event;',
    dropFunction: 'DROP FUNCTION IF EXISTS notify_inbox_outbox_event();',
  };
}

export class PostgreSQLEventListener implements EventListener {
  private readonly logger = new Logger(PostgreSQLEventListener.name);
  private client: Client | null = null;
  private eventsSubject = new Subject<string>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;
  private isStopped = false;
  private readonly reconnectDelayMs: number;
  readonly channelName: string;

  constructor(
    private readonly orm: MikroORM,
    options: PostgreSQLEventListenerOptions = {},
  ) {
    this.reconnectDelayMs = options.reconnectDelayMs ?? 5000;
    this.channelName = options.channelName ?? DEFAULT_POSTGRESQL_EVENT_CHANNEL;
  }

  get events$(): Observable<string> {
    return this.eventsSubject.asObservable();
  }

  async connect(): Promise<void> {
    if (this.isStopped || this.client || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      const config = this.orm.config.getAll();

      this.client = new Client({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.dbName,
      });

      this.client.on('notification', (msg: Notification) => {
        if (msg.channel === this.channelName) {
          this.eventsSubject.next(msg.payload ?? '');
        }
      });

      this.client.on('error', (err: Error) => {
        this.logger.error('PostgreSQL event listener error:', err);
        this.scheduleReconnect();
      });

      this.client.on('end', () => {
        this.client = null;
        this.scheduleReconnect();
      });

      await this.client.connect();
      await this.client.query(`LISTEN ${this.channelName}`);
    } catch (error) {
      this.client = null;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this.isStopped = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.client) {
      try {
        await this.client.query(`UNLISTEN ${this.channelName}`);
        await this.client.end();
      } catch {
        // Ignore errors during disconnect
      }
      this.client = null;
    }

    this.eventsSubject.complete();
  }

  private scheduleReconnect(): void {
    if (this.isStopped || this.reconnectTimeout || this.isConnecting) {
      return;
    }

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      if (this.isStopped) {
        return;
      }
      try {
        await this.connect();
      } catch (error) {
        this.logger.error('PostgreSQL event listener reconnect failed:', error);
        this.scheduleReconnect();
      }
    }, this.reconnectDelayMs);
  }
}
