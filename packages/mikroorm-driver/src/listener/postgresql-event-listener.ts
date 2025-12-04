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
  private isDisconnecting = false;
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
    this.isDisconnecting = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.client) {
      const client = this.client;
      this.client = null;

      // Remove all client-level listeners
      client.removeAllListeners();

      // Access the internal connection to prevent "handleEmptyQuery" errors.
      // The pg library's _handleEmptyQuery doesn't null-check activeQuery,
      // so we replace the handler to safely ignore late messages.
      const connection = (client as unknown as {
        connection: {
          removeAllListeners: (event?: string) => void;
          on: (event: string, handler: () => void) => void;
          stream?: { destroy: () => void };
        };
      }).connection;

      if (connection) {
        // Replace all handlers that could throw when activeQuery is null
        connection.removeAllListeners('emptyQuery');
        connection.removeAllListeners('commandComplete');
        connection.removeAllListeners('rowDescription');
        connection.removeAllListeners('dataRow');
        connection.removeAllListeners('parseComplete');
        connection.removeAllListeners('bindComplete');
        connection.removeAllListeners('portalSuspended');

        // Add no-op handlers to prevent errors from late events
        connection.on('emptyQuery', () => {});
        connection.on('commandComplete', () => {});
        connection.on('rowDescription', () => {});
        connection.on('dataRow', () => {});
        connection.on('parseComplete', () => {});
        connection.on('bindComplete', () => {});
        connection.on('portalSuspended', () => {});

        // Destroy stream to stop further data processing
        if (connection.stream?.destroy) {
          connection.stream.destroy();
        }
      }

      try {
        await client.end();
      } catch {
        // Ignore errors during disconnect - expected after stream destroy
      }
    }

    this.eventsSubject.complete();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout || this.isConnecting || this.isDisconnecting) {
      return;
    }

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        await this.connect();
      } catch (error) {
        this.logger.error('PostgreSQL event listener reconnect failed:', error);
        this.scheduleReconnect();
      }
    }, this.reconnectDelayMs);
  }
}
