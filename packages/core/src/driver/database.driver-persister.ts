export interface DatabaseDriverPersister {

  persist<T>(entity: T): void;

  remove<T>(entity: T): void;

  flush(): Promise<void>;
}