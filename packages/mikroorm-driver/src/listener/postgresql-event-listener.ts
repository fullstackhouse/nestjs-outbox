import { MikroORM } from '@mikro-orm/core';
import { EventListener } from '@nestixis/nestjs-inbox-outbox';
import { Client, Notification } from 'pg';
import { Observable, Subject } from 'rxjs';

export const POSTGRESQL_EVENT_CHANNEL = 'inbox_outbox_event';

export class PostgreSQLEventListener implements EventListener {
  private client: Client | null = null;
  private eventsSubject = new Subject<string>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;

  constructor(
    private readonly orm: MikroORM,
    private readonly reconnectDelayMs = 5000,
  ) {}

  get events$(): Observable<string> {
    return this.eventsSubject.asObservable();
  }

  async connect(): Promise<void> {
    if (this.client || this.isConnecting) {
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
        if (msg.channel === POSTGRESQL_EVENT_CHANNEL) {
          this.eventsSubject.next(msg.payload ?? '');
        }
      });

      this.client.on('error', (err: Error) => {
        console.error('PostgreSQL event listener error:', err);
        this.scheduleReconnect();
      });

      this.client.on('end', () => {
        this.client = null;
        this.scheduleReconnect();
      });

      await this.client.connect();
      await this.client.query(`LISTEN ${POSTGRESQL_EVENT_CHANNEL}`);
    } catch (error) {
      this.client = null;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.client) {
      try {
        await this.client.query(`UNLISTEN ${POSTGRESQL_EVENT_CHANNEL}`);
        await this.client.end();
      } catch {
        // Ignore errors during disconnect
      }
      this.client = null;
    }

    this.eventsSubject.complete();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout || this.isConnecting) {
      return;
    }

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        await this.connect();
      } catch (error) {
        console.error('PostgreSQL event listener reconnect failed:', error);
        this.scheduleReconnect();
      }
    }, this.reconnectDelayMs);
  }
}
