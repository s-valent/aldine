/**
 * Redis URL semantics through the shared builder. This is the regression test
 * for the bug the old hand-parse in collab.ts once fixed and then re-risked:
 * rediss:// TLS, ACL username, and /db must all survive into client options.
 * lazyConnect builds the client without touching the network.
 */
import { check, eq } from './assert.mjs';

process.env.REDIS_URL = 'redis://localhost:6379'; // make redis.ts load ioredis
const { buildClient, redisAvailable } = await import('../src/redis.ts');

check(redisAvailable(), 'ioredis resolves (optionalDependency installed)');

const secure = buildClient('rediss://worker:pw123@cache.example.com:6380/2?family=0', 'test', { lazyConnect: true });
check(secure !== null, 'builds a client');
eq(secure.options.host, 'cache.example.com', 'host');
eq(secure.options.port, 6380, 'port');
eq(secure.options.username, 'worker', 'ACL username survives');
eq(secure.options.password, 'pw123', 'password survives');
eq(secure.options.db, 2, '/db path survives');
eq(secure.options.family, 0, 'query params survive');
check(secure.options.tls != null, 'rediss:// implies TLS');
eq(secure.options.maxRetriesPerRequest, 2, 'default retry policy');
await secure.quit().catch(() => {});

const plain = buildClient('redis://localhost:6379', 'test', { lazyConnect: true, maxRetriesPerRequest: 5 });
check(plain.options.tls == null, 'redis:// has no TLS');
eq(plain.options.maxRetriesPerRequest, 5, 'overrides win');
await plain.quit().catch(() => {});

console.log('Redis client builder: ALL PASSED');
