export type DatabaseEnvironment = 'development' | 'test' | 'staging' | 'production';
export interface DatabaseIdentity {
  environment: DatabaseEnvironment;
  databaseInstanceId: string;
  createdAt: string;
}
export interface DatabaseTarget {
  environment: DatabaseEnvironment;
  databaseInstanceId: string;
  databaseName: string;
}
