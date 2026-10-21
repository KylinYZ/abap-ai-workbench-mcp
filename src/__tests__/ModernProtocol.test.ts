/**
 * MCP 2026-07-28（modern era）协议面测试（0.9.0 迁移）。
 *
 * 锁定的 wire 契约：
 * - server/discover 探测（带 per-request envelope，即 ZCode auto 协商帧形态）
 *   必须返回明确 supportedVersions（含 2026-07-28）与 serverInfo envelope；
 * - modern era 下 tools/list 自动携带 2026 特征字段（ttlMs / cacheScope），
 *   由 v2 era 编码层补齐，handler 无需感知；
 * - 同一服务器实例上 legacy initialize 握手共存（双栈）。
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { AbapAdtServer } from '../index';

const originalEnvironment = { ...process.env };

function configureServer(): AbapAdtServer {
  Object.assign(process.env, {
    SAP_URL: 'https://dev.example.test',
    SAP_USER: 'TEST_USER',
    SAP_PASSWORD: 'not-used',
    SAP_CLIENT: '300',
    SAP_LANGUAGE: 'EN',
    SAP_MCP_SYSTEM_ROLE: 'DEV',
    SAP_MCP_TOOL_PROFILE: 'focused',
    SAP_MCP_ALLOWED_HOSTS: 'dev.example.test',
    SAP_MCP_ALLOWED_CLIENTS: '300',
    SAP_MCP_ALLOWED_NAMESPACES: 'Z,Y'
  });
  return new AbapAdtServer();
}

describe('modern protocol (2026-07-28) surface', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('answers server/discover with explicit supportedVersions and server identity', async () => {
    const server = configureServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // modern era 的 discover 应答由 serveStdio 层提供：测试用 transport 选项
    // 挂 InMemoryTransport（等价于生产 stdio 入口的 era 决策路径）
    const handle = serveStdio(() => server, { transport: serverTransport, onerror: () => undefined });
    const client = new Client(
      { name: 'discover-probe', version: '0' },
      {
        capabilities: {},
        supportedProtocolVersions: ['2026-07-28', '2025-06-18'],
        versionNegotiation: { mode: 'auto' as const }
      }
    );
    await client.connect(clientTransport);
    try {
      const discover = await client.request(
        { method: 'server/discover', params: {} },
        { timeout: 5_000 } as never
      ) as unknown as { supportedVersions?: string[]; _meta?: Record<string, unknown> };
      expect(discover.supportedVersions).toContain('2026-07-28');
      const serverInfo = discover._meta?.['io.modelcontextprotocol/serverInfo'] as { name?: string } | undefined;
      expect(serverInfo?.name).toBe('abap-ai-workbench-mcp');
    } finally {
      await Promise.allSettled([handle.close(), server.close(), client.close()]);
    }
  });

  it('serves tools/list on a modern connection with 2026 wire characteristics', async () => {
    const server = configureServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // 窃听服务器出站 wire：2026 特征字段（ttlMs/cacheScope）由 era 编码层补齐；
    // modern era 需经 serveStdio 的 era 决策层（transport 选项挂 InMemoryTransport）
    const outbound: JSONRPCMessage[] = [];
    (serverTransport as any).send = (() => {
      const raw = (serverTransport as any).send.bind(serverTransport);
      return async (message: JSONRPCMessage, options?: unknown) => {
        outbound.push(message);
        return raw(message, options as never);
      };
    })();
    const handle = serveStdio(() => server, { transport: serverTransport, onerror: () => undefined });
    const client = new Client(
      { name: 'modern-client', version: '0' },
      {
        capabilities: {},
        supportedProtocolVersions: ['2026-07-28', '2025-06-18'],
        versionNegotiation: { mode: 'auto' as const }
      }
    );
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      // focused（development-workbench）profile 的运行时数量基线
      expect(listed.tools.length).toBe(188);
      const listResultOnWire = outbound.find(m => {
        const candidate = m as { result?: { tools?: unknown[] } };
        return 'result' in m && Array.isArray(candidate.result?.tools);
      }) as { result?: Record<string, unknown> } | undefined;
      expect(listResultOnWire).toBeDefined();
      expect(listResultOnWire!.result).toHaveProperty('ttlMs');
      expect(listResultOnWire!.result).toHaveProperty('cacheScope');
    } finally {
      await Promise.allSettled([handle.close(), server.close(), client.close()]);
    }
  });

  it('still serves a plain legacy initialize handshake on the same server class', async () => {
    const server = configureServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    // 默认 versionNegotiation = 'legacy'：走 initialize 握手（2025 客户端形态）
    const client = new Client({ name: 'legacy-client', version: '0' }, { capabilities: {} });
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.length).toBe(188);
      // legacy era 结果不携带 2026 专属字段（era 编码按连接分流）
      expect(listed).not.toHaveProperty('ttlMs');
    } finally {
      await Promise.allSettled([server.close(), client.close()]);
    }
  });
});
