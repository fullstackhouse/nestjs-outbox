export interface DatabaseDriverPersister {
  persist<T extends object>(entity: T): void;

  remove<T extends object>(entity: T): void;

  flush(): Promise<void>;
}
