import { useEffect, useState, useCallback } from 'react';
import {
    Table, Typography, Spin, Card, Row, Col, Tag, Button, Space, message, Radio, Input
} from 'antd';
import { ReloadOutlined, CopyOutlined, EditOutlined, UserAddOutlined } from '@ant-design/icons';
import { whaleApi } from '../api/client';

const { Title, Text } = Typography;

interface WatchedWhaleEntry {
    address: string;
    label?: string;
    // Data fields fetched from profile
    pnl?: number;
    volume?: number;
    userName?: string;
    tradeCount?: number;
    tradeCountDisplay?: string;
    winRate?: number | null;
    smartScore?: number | null;
}

function WatchedWhales() {
    const [loading, setLoading] = useState(true);
    const [originalList, setOriginalList] = useState<{ address: string; label: string }[]>([]);
    const [watchedList, setWatchedList] = useState<WatchedWhaleEntry[]>([]);
    const [timePeriod, setTimePeriod] = useState<'24h' | '7d' | '30d' | 'all'>('all');

    // Period data cache
    const [periodData, setPeriodData] = useState<Record<string, { pnl: number; volume: number; tradeCount: number | null; tradeCountDisplay?: string; winRate: number | null; smartScore: number | null }>>({});

    // Editing state for labels
    const [editingAddress, setEditingAddress] = useState<string | null>(null);
    const [editLabel, setEditLabel] = useState('');

    // Load watched list
    const loadWatchedList = useCallback(async () => {
        try {
            setLoading(true);
            const res = await (whaleApi as any).getWatched();
            const list = res.data.map((item: any) => {
                if (typeof item === 'string') return { address: item, label: '' };
                return item;
            });

            setOriginalList(list);

            // Initialize watchedList with addresses
            setWatchedList(list.map((item: any) => ({
                address: item.address,
                label: item.label
            })));
        } catch {
            setWatchedList([]);
        } finally {
            setLoading(false);
        }
    }, []);

    // Load period data for the list
    const loadPeriodData = useCallback(async (period: '24h' | '7d' | '30d' | 'all', addresses: string[]) => {
        if (addresses.length === 0) return;

        try {
            // First try bulk cache
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

            // Fetch missing from API
            if (missingAddresses.length > 0) {
                for (const address of missingAddresses) {
                    try {
                        const res = await whaleApi.getProfile(address, period);
                        if (res.data.status === 'success') {
                            setPeriodData(prev => ({ ...prev, [address]: res.data }));
                        }
                    } catch {
                        // Error handling
                    }
                }
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    useEffect(() => {
        loadWatchedList();
    }, [loadWatchedList]);

    useEffect(() => {
        if (originalList.length > 0) {
            const addresses = originalList.map(item => item.address);
            loadPeriodData(timePeriod, addresses);
        }
    }, [originalList, timePeriod, loadPeriodData]);

    // Handle Label Update
    const handleLabelUpdate = async (address: string, newLabel: string) => {
        try {
            await (whaleApi as any).toggleWatch(address, true, newLabel);
            setOriginalList(prev => prev.map(item => item.address === address ? { ...item, label: newLabel } : item));
            setEditingAddress(null);
            message.success('标签已更新');
        } catch {
            message.error('更新失败');
        }
    };

    // Unwatch
    const handleUnwatch = async (address: string) => {
        try {
            await (whaleApi as any).toggleWatch(address, false);
            setOriginalList(prev => prev.filter(item => item.address !== address));
            setWatchedList(prev => prev.filter(item => item.address !== address));
            message.success('已取消监控');
        } catch {
            message.error('操作失败');
        }
    };

    const formatAmount = (amount: number) => {
        if (Math.abs(amount) >= 1000000) {
            return `$${(amount / 1000000).toFixed(2)}M`;
        }
        if (Math.abs(amount) >= 1000) {
            return `$${(amount / 1000).toFixed(1)}K`;
        }
        return `$${amount.toFixed(0)}`;
    };

    const columns: any[] = [
        {
            title: '交易员',
            key: 'address',
            render: (_: any, record: WatchedWhaleEntry) => {
                const displayName = record.address.slice(0, 6) + '...' + record.address.slice(-4);
                return (
                    <Space>
                        <a
                            href={`https://polymarket.com/profile/${record.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#1890ff' }}
                        >
                            {displayName}
                        </a>
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
            width: 150,
        },
        {
            title: '标签',
            key: 'label',
            render: (_: any, record: WatchedWhaleEntry) => {
                const isEditing = editingAddress === record.address;
                const label = originalList.find(x => x.address === record.address)?.label || '';

                if (isEditing) {
                    return (
                        <Input
                            autoFocus
                            size="small"
                            maxLength={6}
                            value={editLabel}
                            onChange={e => setEditLabel(e.target.value)}
                            onBlur={() => handleLabelUpdate(record.address, editLabel)}
                            onPressEnter={() => handleLabelUpdate(record.address, editLabel)}
                            style={{ width: 80 }}
                        />
                    );
                }

                return (
                    <Space>
                        <Tag color={label ? "blue" : "default"}>{label || "无标签"}</Tag>
                        <EditOutlined
                            style={{ cursor: 'pointer', color: '#888', fontSize: 12 }}
                            onClick={() => {
                                setEditLabel(label);
                                setEditingAddress(record.address);
                            }}
                        />
                    </Space>
                );
            },
            width: 120,
        },
        {
            title: '盈亏',
            key: 'pnl',
            render: (_: any, record: WatchedWhaleEntry) => {
                const pd = periodData[record.address];
                if (!pd) return <Spin size="small" />;
                const pnl = pd.pnl;
                return (
                    <span style={{ color: pnl && pnl >= 0 ? '#52c41a' : '#ff4d4f' }}>
                        {pnl !== undefined ? formatAmount(pnl) : 'N/A'}
                    </span>
                );
            },
            width: 100,
        },
        {
            title: '交易量',
            key: 'volume',
            render: (_: any, record: WatchedWhaleEntry) => {
                const pd = periodData[record.address];
                if (!pd) return <Spin size="small" />;
                return pd.volume !== undefined ? formatAmount(pd.volume) : 'N/A';
            },
            width: 100,
        },
        {
            title: '胜率',
            key: 'winRate',
            render: (_: any, record: WatchedWhaleEntry) => {
                const pd = periodData[record.address];
                if (!pd) return <Spin size="small" />;
                // Handle null winRate
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
            title: '交易次数',
            key: 'tradeCount',
            render: (_: any, record: WatchedWhaleEntry) => {
                const pd = periodData[record.address];
                if (!pd) return <Spin size="small" />;
                if (pd.tradeCount === null) return <Spin size="small" />;
                return pd.tradeCountDisplay || pd.tradeCount;
            },
            width: 100,
        },
        {
            title: 'ROI',
            key: 'roi',
            render: (_: any, record: WatchedWhaleEntry) => {
                const pd = periodData[record.address];
                if (!pd) return <Spin size="small" />;
                const pnl = pd.pnl;
                const volume = pd.volume;
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
            render: (_: any, record: WatchedWhaleEntry) => {
                const pd = periodData[record.address];
                if (!pd) return <Spin size="small" />;
                if (pd.smartScore === null) return <Spin size="small" />;
                return <Tag color="blue">{pd.smartScore}</Tag>;
            },
            width: 70,
        },
        {
            title: '操作',
            key: 'action',
            render: (_: any, record: WatchedWhaleEntry) => (
                <Button
                    type="link"
                    danger
                    size="small"
                    onClick={() => handleUnwatch(record.address)}
                >
                    取消监控
                </Button>
            ),
            width: 100
        },
        {
            title: '跟单',
            key: 'follow',
            render: () => (
                <Button
                    type="primary"
                    size="small"
                    icon={<UserAddOutlined />}
                    onClick={() => message.info('跟单功能开发中...')}
                >
                    跟单
                </Button>
            ),
            width: 100,
            align: 'center' as const,
        }
    ];

    return (
        <div>
            <Title level={3} style={{ color: '#fff', marginBottom: 24 }}>
                👀 已跟踪鲸鱼
            </Title>

            {/* 控制面板 */}
            <Card style={{ marginBottom: 24 }}>
                <Row gutter={[16, 16]} align="middle">
                    <Col>
                        <Space>
                            <Button
                                icon={<ReloadOutlined />}
                                onClick={loadWatchedList}
                                loading={loading}
                            >
                                刷新列表
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
                    dataSource={watchedList}
                    rowKey="address"
                    loading={loading}
                    pagination={{
                        defaultPageSize: 20,
                        showSizeChanger: true,
                        pageSizeOptions: ['10', '20', '50', '100'],
                        showTotal: (total) => `共 ${total} 条`
                    }}
                    size="small"
                    scroll={{ x: 1200 }}
                />
            </Card>
        </div>
    );
}

export default WatchedWhales;
