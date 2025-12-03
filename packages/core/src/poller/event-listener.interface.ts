import { Observable } from 'rxjs';

export const EVENT_LISTENER_TOKEN = 'EVENT_LISTENER_TOKEN';

export interface EventListener {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  events$: Observable<string>;
}
