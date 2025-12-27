import { useEffect, useState, useCallback } from 'react';
import {
    Table, Typography, Spin, Card, Row, Col, Tag, Button, Space, message, Radio, Checkbox
} from 'antd';
import { ReloadOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { walletApi, whaleApi, versionApi } from '../api/client';
import { WEB_VERSION } from '../version';

const { Title, Text } = Typography;

interface LeaderboardEntry {
    address: string;
    rank: number;
    pnl: number;
    volume: number;
    userName?: string;
    xUsername?: string;
    verifiedBadge?: boolean;
    profileImage?: string;
    trades?: number;
    positions?: number;
}

function TopWhaleDiscovery() {
    const [loading, setLoading] = useState(true);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [timePeriod, setTimePeriod] = useState<'24h' | '7d' | '30d' | 'all'>('all');
    const [periodData, setPeriodData] = useState<Record<string, { pnl: number; volume: number; tradeCount: number | null; tradeCountDisplay?: string; winRate: number | null; smartScore: number | null; fromLeaderboard?: boolean }>>({});
    const [watchedAddresses, setWatchedAddresses] = useState<Set<string>>(new Set());

    // 版本信息
    const [apiVersion, setApiVersion] = useState('');
    const [sdkVersion, setSdkVersion] = useState('');

    // 加载版本信息
    useEffect(() => {
        versionApi.getVersion().then(res => {
            setApiVersion(res.data.api);
            setSdkVersion(res.data.sdk);
        }).catch(() => { });
    }, []);

    const loadLeaderboard = useCallback(async () => {
        try {
            setLoading(true);
            const res = await walletApi.getLeaderboard(500);
            setLeaderboard(res.data);
        } catch {
            setLeaderboard([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadWatched = useCallback(async () => {
        try {
            const res = await (whaleApi as any).getWatched();
            setWatchedAddresses(new Set(res.data.map((a: string) => a.toLowerCase())));
        } catch { }
    }, []);

    const toggleWatch = async (address: string, checked: boolean) => {
        try {
            const normalized = address.toLowerCase();
            await (whaleApi as any).toggleWatch(normalized, checked);
            setWatchedAddresses(prev => {
                const next = new Set(prev);
                if (checked) next.add(normalized);
                else next.delete(normalized);
                return next;
            });
            message.success(checked ? '已开始监控该地址' : '已取消监控');
        } catch {
            message.error('同步监控状态失败');
        }
    };

    // 加载时间段数据
    const loadPeriodData = useCallback(async (period: '24h' | '7d' | '30d' | 'all', addresses: string[]) => {
        if (addresses.length === 0) return;

        try {
            const bulkRes = await whaleApi.getCacheBulk(addresses);
            const bulkData = bulkRes.data as Record<string, { cached: boolean; periods?: any }>;

            const newPeriodData: Record<string, any> = {};
            const missingAddresses: string[] = [];

            for (const addr of addresses) {
                const cached = bulkData[addr];
                if (cached?.cached && cached.periods?.[period]) {
                    newPeriodData[addr] = cached.periods[period];
                } else {
                    missingAddresses.push(addr);
                }
            }

            setPeriodData(prev => ({ ...prev, ...newPeriodData }));

            if (missingAddresses.length > 0) {
                for (const address of missingAddresses) {
                    try {
                        const res = await whaleApi.getProfile(address, period);
                        // 如果返回 pending，不更新数据，让列表保持加载状态
                        if (res.data.status === 'success') {
                            setPeriodData(prev => ({ ...prev, [address]: res.data }));
                        }
                    } catch {
                        // 真正的失败才设为默认值
                        setPeriodData(prev => ({
                            ...prev,
                            [address]: { pnl: 0, volume: 0, tradeCount: 0, winRate: 0, smartScore: 0 }
                        }));
                    }
                }
            }
        } catch {
            for (const address of addresses) {
                try {
                    const res = await whaleApi.getProfile(address, period);
                    if (res.data.status === 'success') {
                        setPeriodData(prev => ({ ...prev, [address]: res.data }));
                    }
                } catch {
                    setPeriodData(prev => ({
                        ...prev,
                        [address]: { pnl: 0, volume: 0, tradeCount: 0, winRate: 0, smartScore: 0 }
                    }));
                }
            }
        }
    }, []);

    useEffect(() => {
        loadLeaderboard();
        loadWatched();
    }, [loadLeaderboard, loadWatched]);

    // 当时间段或数据变化时加载数据
    useEffect(() => {
        if (leaderboard.length > 0) {
            if (timePeriod === 'all') {
                // ALL: 立即用 leaderboard 数据填充，同时后台拉取完整数据
                const initialData: Record<string, any> = {};
                for (const entry of leaderboard) {
                    initialData[entry.address] = {
                        pnl: entry.pnl,
                        volume: entry.volume,
                        tradeCount: entry.trades || null, // null 表示待加载
                        winRate: null, // 待后台填充
                        smartScore: null,
                        fromLeaderboard: true, // 标记来源
                    };
                }
                setPeriodData(initialData);

                // 后台触发 Data API 拉取（不阻塞）
                const addresses = leaderboard.map(w => w.address);
                loadPeriodData(timePeriod, addresses);
            } else {
                // 其他时间段：检查缓存，无缓存则显示 loading
                setPeriodData({});
                const addresses = leaderboard.map(w => w.address);
                loadPeriodData(timePeriod, addresses);
            }
        }
    }, [timePeriod, leaderboard, loadPeriodData]);

    // 轮询机制：持续检查并合并后台数据
    useEffect(() => {
        if (leaderboard.length === 0) return;

        const interval = setInterval(async () => {
            // 找出需要更新的地址：无数据 或 (ALL且只有leaderboard数据)
            const addressesToUpdate = leaderboard
                .map(w => w.address)
                .filter(addr => {
                    const pd = periodData[addr];
                    if (!pd) return true;
                    // ALL 时，如果还是 leaderboard 数据，继续尝试获取完整数据
                    if (timePeriod === 'all' && pd.fromLeaderboard) return true;
                    return false;
                });

            if (addressesToUpdate.length > 0) {
                // 批量检查缓存状态
                try {
                    const bulkRes = await whaleApi.getCacheBulk(addressesToUpdate.slice(0, 50)); // 每次最多50个
                    const bulkData = bulkRes.data as Record<string, { cached: boolean; periods?: any }>;

                    const updates: Record<string, any> = {};
                    for (const addr of addressesToUpdate.slice(0, 50)) {
                        const cached = bulkData[addr];
                        if (cached?.cached && cached.periods?.[timePeriod]) {
                            updates[addr] = {
                                ...cached.periods[timePeriod],
                                fromLeaderboard: false, // 标记为完整数据
                            };
                        }
                    }

                    if (Object.keys(updates).length > 0) {
                        setPeriodData(prev => ({ ...prev, ...updates }));
                    }
                } catch { }
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [leaderboard, periodData, timePeriod]);

    const formatAmount = (amount: number) => {
        if (Math.abs(amount) >= 1000000) {
            return `$${(amount / 1000000).toFixed(2)}M`;
        }
        if (Math.abs(amount) >= 1000) {
            return `$${(amount / 1000).toFixed(1)}K`;
        }
        return `$${amount.toFixed(0)}`;
    };

    const exportToCsv = () => {
        if (leaderboard.length === 0) return;

        const headers = ['排名', '地址', '用户名', '盈亏', '交易量', '胜率', '交易次数', '分数'];
        const rows = leaderboard.map((entry) => {
            const pd = periodData[entry.address];
            return [
                entry.rank,
                entry.address,
                entry.userName || entry.xUsername || '-',
                pd?.pnl?.toFixed(2) || entry.pnl?.toFixed(2) || '0',
                pd?.volume?.toFixed(2) || entry.volume?.toFixed(2) || '0',
                pd?.winRate ? `${(pd.winRate * 100).toFixed(0)}%` : 'N/A',
                pd?.tradeCount || 'N/A',
                pd?.smartScore || 'N/A',
            ].join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `top_whales_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        message.success('导出成功');
    };

    const columns = [
        {
            title: '#',
            key: 'rank',
            dataIndex: 'rank',
            width: 50,
        },
        {
            title: '交易员',
            key: 'address',
            render: (_: any, record: LeaderboardEntry) => {
                const displayName = record.userName || record.xUsername || `${record.address.slice(0, 6)}...${record.address.slice(-4)}`;
                const truncatedName = displayName.length > 20 ? `${displayName.slice(0, 17)}...` : displayName;
                return (
                    <Space>
                        <a
                            href={`https://polymarket.com/profile/${record.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#1890ff' }}
                            title={displayName}
                        >
                            {truncatedName}
                        </a>
                        {record.verifiedBadge && <Tag color="blue">✓</Tag>}
                        <CopyOutlined
                            style={{ cursor: 'pointer', color: '#888' }}
                            onClick={() => {
                                navigator.clipboard.writeText(record.address);
                                message.success('地址已复制');
                            }}
                        />
                    </Space>
                );
            },
            width: 180,
        },
        {
            title: '监控',
            key: 'watch',
            render: (_: any, record: LeaderboardEntry) => (
                <Checkbox
                    checked={watchedAddresses.has(record.address.toLowerCase())}
                    onChange={(e) => toggleWatch(record.address, e.target.checked)}
                />
            ),
            width: 70,
            align: 'center' as const,
        },
        {
            title: '盈亏',
            key: 'pnl',
            render: (_: any, record: LeaderboardEntry) => {
                const pd = periodData[record.address];
                // 切换时间段时 periodData 被清空，显示 loading
                if (!pd) return <Spin size="small" />;
                const pnl = pd.pnl;
                return (
                    <span style={{ color: pnl && pnl >= 0 ? '#52c41a' : '#ff4d4f' }}>
                        {pnl !== undefined ? formatAmount(pnl) : 'N/A'}
                    </span>
                );
            },
            width: 120,
        },
        {
            title: '胜率',
            key: 'winRate',
            render: (_: any, record: LeaderboardEntry) => {
                const pd = periodData[record.address];
                if (!pd) return <Spin size="small" />;
                if (pd.winRate === null) return <Spin size="small" />;
                return (
                    <Tag color={pd.winRate >= 0.55 ? 'green' : 'default'}>
                        {`${(pd.winRate * 100).toFixed(0)}%`}
                    </Tag>
                );
            },
            width: 80,
        },
        {
            title: '交易量',
            key: 'volume',
            render: (_: any, record: LeaderboardEntry) => {
                const pd = periodData[record.address];
                // 切换时间段时 periodData 被清空，显示 loading
                if (!pd) return <Spin size="small" />;
                const volume = pd.volume;
                return volume !== undefined ? formatAmount(volume) : 'N/A';
            },
            width: 100,
        },
        {
            title: '交易次数',
            key: 'tradeCount',
            render: (_: any, record: LeaderboardEntry) => {
                const pd = periodData[record.address];
                if (!pd) return <Spin size="small" />;
                if (pd.tradeCount === null) return <Spin size="small" />;
                // 如果有 tradeCountDisplay（表示数据被截断），显示 "> XXXX"
                return pd.tradeCountDisplay || pd.tradeCount;
            },
            width: 100,
        },
        {
            title: 'ROI',
            key: 'roi',
            render: (_: any, record: LeaderboardEntry) => {
                const pd = periodData[record.address];
                const pnl = pd ? pd.pnl : record.pnl;
                const volume = pd ? pd.volume : record.volume;
                if (!pd) return <Spin size="small" />;
                if (pnl === undefined || volume === undefined || volume === 0) return 'N/A';
                const roi = (pnl / volume) * 100;
                return (
                    <span style={{ color: roi >= 0 ? '#52c41a' : '#ff4d4f' }}>
                        {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
                    </span>
                );
            },
            width: 80,
        },
        {
            title: '分数',
            key: 'score',
            render: (_: any, record: LeaderboardEntry) => {
                const pd = periodData[record.address];
                if (!pd) return <Spin size="small" />;
                if (pd.smartScore === null) return <Spin size="small" />;
                return <Tag color="blue">{pd.smartScore}</Tag>;
            },
            width: 70,
        },
    ];

    return (
        <div>
            <Title level={3} style={{ color: '#fff', marginBottom: 24 }}>
                🏆 Top 鲸鱼发现
            </Title>

            {/* 控制面板 */}
            <Card style={{ marginBottom: 24 }}>
                <Row gutter={[16, 16]} align="middle">
                    <Col>
                        <Space>
                            <Button
                                icon={<ReloadOutlined />}
                                onClick={loadLeaderboard}
                                loading={loading}
                            >
                                刷新排行榜
                            </Button>
                            <Button
                                icon={<DownloadOutlined />}
                                onClick={exportToCsv}
                                disabled={leaderboard.length === 0}
                            >
                                导出 CSV
                            </Button>
                        </Space>
                    </Col>
                    <Col flex="auto" style={{ textAlign: 'right' }}>
                        <Space>
                            <Text type="secondary">时间段:</Text>
                            <Radio.Group
                                value={timePeriod}
                                onChange={(e) => setTimePeriod(e.target.value)}
                                optionType="button"
                                buttonStyle="solid"
                            >
                                <Radio.Button value="24h">24H</Radio.Button>
                                <Radio.Button value="7d">7D</Radio.Button>
                                <Radio.Button value="30d">30D</Radio.Button>
                                <Radio.Button value="all">ALL</Radio.Button>
                            </Radio.Group>
                        </Space>
                    </Col>
                </Row>
            </Card>

            {/* 数据表格 */}
            <Card>
                <Table
                    columns={columns}
                    dataSource={leaderboard}
                    rowKey="address"
                    loading={loading}
                    pagination={{
                        defaultPageSize: 20,
                        showSizeChanger: true,
                        pageSizeOptions: ['10', '20', '50', '100', '200', '500'],
                        showTotal: (total) => `共 ${total} 条`
                    }}
                    size="small"
                    scroll={{ x: 1000 }}
                />
            </Card>

            {/* 版本信息 */}
            <div style={{ marginTop: 16, textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                    Web {WEB_VERSION} | API {apiVersion} | SDK {sdkVersion}
                </Text>
            </div>
        </div>
    );
}

export default TopWhaleDiscovery;
