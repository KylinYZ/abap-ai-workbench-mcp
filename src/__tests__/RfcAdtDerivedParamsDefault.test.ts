import { describe, expect, it } from '@jest/globals';

/**
 * ============================================================================
 * rfcParamsFromEnvironment 缺省实例号回归测试（RFC_SYSNR 未配置时）
 * ============================================================================
 *
 * 背景：RFC 直链连接参数由既有 ADT 环境推导，实例号仅在调用方显式提供
 * RFC_SYSNR 时覆盖。缺省值从 '01'（专用 DEV 单点实测值）调整为 '00'
 * （多数 SAP 系统主实例号为 00——HTTP 端口 80NN/36NN/网关 33NN 与实例号
 * 的对应关系是运维常识，'00' 覆盖绝大多数真实环境）。
 *
 * 本测试锁定缺省语义，防止后续被无意改回单环境值：
 *   1. 未提供 sysnr → 归一化结果为 '00'（网关端口 3300）；
 *   2. 显式 sysnr 仍然原样保留（覆盖优先于缺省）。
 */

import { rfcParamsFromEnvironment } from '../rfc/open-rfc-transport.js';

describe('rfcParamsFromEnvironment default sysnr', () => {
  it('defaults to instance 00 (gateway port 3300) when RFC_SYSNR is absent', () => {
    const params = rfcParamsFromEnvironment({
      host: '10.30.255.42',
      client: '200',
      user: 'DEVUSER',
      password: 'secret'
    });
    expect(params.sysnr).toBe('00');
    expect(params.port).toBeUndefined(); // 存储上只保留用户提供的一个寻址字段
  });

  it('keeps an explicit sysnr override untouched', () => {
    const params = rfcParamsFromEnvironment({
      host: '10.30.254.48',
      client: '300',
      user: 'DEVUSER',
      password: 'secret',
      sysnr: '01'
    });
    expect(params.sysnr).toBe('01');
  });
});
