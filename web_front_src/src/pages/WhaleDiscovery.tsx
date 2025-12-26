import { useEffect, useState, useCallback } from 'react';
import {
    Table, Typography, Spin, Alert, Card, Row, Col, Tag, Button, Space,
    Statistic, Badge, Input, Form, Modal, message, InputNumber, Avatar, Radio
} from 'antd';
import {
    PlayCircleOutlined, PauseOutlined, ReloadOutlined, SettingOutlined, CopyOutlined
} from '@ant-design/icons';
import { whaleApi } from '../api/client';

const { Title, Text } = Typography;

interface WhaleCandidate {
    address: string;
    userName?: string;
    profileImage?: string;
    discoveredAt: string;
    tradesObserved: number;
    volumeObserved: number;
    profile?: {
        pnl: number;
        winRate: number;
        totalVolume: number;
        smartScore: number;
        totalTrades: number;
    };
}

interface ServiceStatus {
    running: boolean;
    mode: string;
    startedAt: string | null;
    runtime: string;
    tradesObserved: number;
    addressesAnalyzed: number;
    whalesDiscovered: number;
    queueSize: number;
}

function WhaleDiscovery() {
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<ServiceStatus | null>(null);
    const [whales, setWhales] = useState<WhaleCandidate[]>([]);
    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [infuraKey, setInfuraKey] = useState('');
    const [timePeriod, setTimePeriod] = useState<'24h' | '7d' | '30d' | 'all'>('all');
    const [periodData, setPeriodData] = useState<Record<string, { pnl: number; volume: number; tradeCount: number; winRate: number; smartScore: number }>>({});
    const [loadingPeriod, setLoadingPeriod] = useState(false);
    const [form] = Form.useForm();

    const loadStatus = useCallback(async () => {
        try {
            const res = await whaleApi.getStatus();
            setStatus(res.data);
        } catch {
            setStatus(null);
        }
    }, []);

    const loadWhales = useCallback(async () => {
        try {
            const res = await whaleApi.getWhales('pnl', 50);
            setWhales(res.data);
        } catch {
            setWhales([]);
        }
    }, []);

    // 加载时间段数据 - 顺序处理避免 Rate Limit，实时更新进度
    const loadPeriodData = useCallback(async (period: '24h' | '7d' | '30d' | 'all', addresses: string[]) => {
        if (addresses.length === 0) return;

        setLoadingPeriod(true);
        // 清空旧数据，准备加载新数据
        setPeriodData({});

        // 顺序请求，每完成一个立即更新显示
        for (const address of addresses) {
            try {
                const res = await whaleApi.getProfile(address, period);
                setPeriodData(prev => ({ ...prev, [address]: res.data }));
            } catch {
                setPeriodData(prev => ({ ...prev, [address]: { pnl: 0, volume: 0, tradeCount: 0, winRate: 0, smartScore: 0 } }));
            }
        }

        setLoadingPeriod(false);
    }, []);

    useEffect(() => {
        loadStatus().finally(() => setLoading(false));
        loadWhales();

        // 每 5 秒刷新状态
        const interval = setInterval(() => {
            loadStatus();
            loadWhales();
        }, 5000);

        return () => clearInterval(interval);
    }, [loadStatus, loadWhales]);

    // 当时间段变化时加载时间段数据（不依赖 whales 变化，避免自动刷新）
    useEffect(() => {
        if (timePeriod !== 'all' && whales.length > 0) {
            const addresses = whales.map(w => w.address);
            loadPeriodData(timePeriod, addresses);
        } else {
            setPeriodData({});
        }
        // 只在 timePeriod 变化时触发，不监听 whales 变化
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timePeriod]);

    const handleStart = async () => {
        if (!infuraKey) {
            setConfigModalOpen(true);
            return;
        }
        try {
            await whaleApi.start({ infuraApiKey: infuraKey });
            message.success('服务已启动');
            loadStatus();
        } catch (err: any) {
            message.error(err.response?.data?.error || '启动失败');
        }
    };

    const handleStop = async () => {
        try {
            await whaleApi.stop();
            message.success('服务已停止');
            loadStatus();
        } catch (err: any) {
            message.error(err.response?.data?.error || '停止失败');
        }
    };


    const handleConfigSave = async () => {
        const values = form.getFieldsValue();
        // 保存 Infura Key 到 localStorage
        setInfuraKey(values.infuraKey || '');
        localStorage.setItem('INFURA_API_KEY', values.infuraKey || '');

        // 保存配置到后端（无论服务是否运行都保存到文件）
        try {
            await whaleApi.updateConfig({
                minTradeUsdcValue: values.minTradeUsdcValue,
                minWinRate: values.minWinRate,
                minPnl: values.minPnl,
                minVolume: values.minVolume,
                minTradesObserved: values.minTradesObserved,
                analysisIntervalSec: values.analysisIntervalSec,
            });
        } catch {
            message.warning('配置保存失败');
        }

        setConfigModalOpen(false);
        message.success('配置已保存');
    };

    // 加载配置到表单
    const loadConfigToForm = useCallback(async () => {
        try {
            const res = await whaleApi.getConfig();
            form.setFieldsValue({
                minTradeUsdcValue: res.data.minTradeUsdcValue,
                minWinRate: res.data.minWinRate,
                minPnl: res.data.minPnl,
                minVolume: res.data.minVolume,
                minTradesObserved: res.data.minTradesObserved,
                analysisIntervalSec: res.data.analysisIntervalSec,
            });
        } catch {
            // 使用默认值
        }
    }, [form]);

    // 打开配置弹窗时加载配置
    const handleOpenConfig = async () => {
        await loadConfigToForm();
        setConfigModalOpen(true);
    };

    useEffect(() => {
        const saved = localStorage.getItem('INFURA_API_KEY');
        if (saved) {
            setInfuraKey(saved);
            form.setFieldsValue({ infuraKey: saved });
        }
    }, [form]);

    const formatAmount = (amount: number) => {
        if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`;
        if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
        return `$${amount.toFixed(0)}`;
    };

    const columns = [
        {
            title: '#',
            key: 'index',
            render: (_: any, __: any, index: number) => index + 1,
            width: 50,
        },
        {
            title: '交易员',
            key: 'trader',
            render: (_: any, record: WhaleCandidate) => (
                <Space size={8}>
                    <Avatar
                        src={record.profileImage}
                        size={32}
                        style={{ backgroundColor: '#1890ff' }}
                    >
                        {record.userName?.charAt(0) || record.address?.slice(2, 4).toUpperCase()}
                    </Avatar>
                    <div>
                        <a
                            href={`https://polymarket.com/profile/${record.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontWeight: 500, color: record.userName ? '#1890ff' : '#fff' }}
                        >
                            {record.userName || `${record.address?.slice(0, 6)}...${record.address?.slice(-4)}`}
                        </a>
                        <Space size={4}>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                                {record.address?.slice(0, 8)}...{record.address?.slice(-6)}
                            </Text>
                            <CopyOutlined
                                style={{ color: '#888', cursor: 'pointer', fontSize: 11 }}
                                onClick={() => {
                                    navigator.clipboard.writeText(record.address);
                                    message.success('地址已复制');
                                }}
                            />
                        </Space>
                    </div>
                </Space>
            ),
            width: 250,
        },
        {
            title: '盈亏',
            key: 'pnl',
            render: (_: any, record: WhaleCandidate) => {
                const pd = periodData[record.address];
                const pnl = timePeriod !== 'all' && pd ? pd.pnl : record.profile?.pnl;
                const showLoading = timePeriod !== 'all' && loadingPeriod && !pd;
                if (showLoading) return <Spin size="small" />;
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
            render: (_: any, record: WhaleCandidate) => {
                const pd = periodData[record.address];
                const winRate = timePeriod !== 'all' && pd ? pd.winRate : record.profile?.winRate;
                const showLoading = timePeriod !== 'all' && loadingPeriod && !pd;
                if (showLoading) return <Spin size="small" />;
                return (
                    <Tag color={winRate && winRate >= 0.55 ? 'green' : 'default'}>
                        {winRate !== undefined ? `${(winRate * 100).toFixed(0)}%` : 'N/A'}
                    </Tag>
                );
            },
            width: 80,
        },
        {
            title: '交易量',
            key: 'volume',
            render: (_: any, record: WhaleCandidate) => {
                const pd = periodData[record.address];
                const volume = timePeriod !== 'all' && pd ? pd.volume : record.profile?.totalVolume;
                const showLoading = timePeriod !== 'all' && loadingPeriod && !pd;
                if (showLoading) return <Spin size="small" />;
                return volume !== undefined ? formatAmount(volume) : 'N/A';
            },
            width: 100,
        },
        {
            title: '交易次数',
            key: 'tradeCount',
            render: (_: any, record: WhaleCandidate) => {
                const pd = periodData[record.address];
                const tradeCount = timePeriod !== 'all' && pd ? pd.tradeCount : record.profile?.totalTrades;
                const showLoading = timePeriod !== 'all' && loadingPeriod && !pd;
                if (showLoading) return <Spin size="small" />;
                return tradeCount !== undefined ? tradeCount : 'N/A';
            },
            width: 80,
        },
        {
            title: 'ROI',
            key: 'roi',
            render: (_: any, record: WhaleCandidate) => {
                const pd = periodData[record.address];
                const pnl = timePeriod !== 'all' && pd ? pd.pnl : record.profile?.pnl;
                const volume = timePeriod !== 'all' && pd ? pd.volume : record.profile?.totalVolume;
                const showLoading = timePeriod !== 'all' && loadingPeriod && !pd;
                if (showLoading) return <Spin size="small" />;
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
            render: (_: any, record: WhaleCandidate) => {
                const pd = periodData[record.address];
                const score = timePeriod !== 'all' && pd ? pd.smartScore : record.profile?.smartScore;
                const showLoading = timePeriod !== 'all' && loadingPeriod && !pd;
                if (showLoading) return <Spin size="small" />;
                return <Tag color="blue">{score || 0}</Tag>;
            },
            width: 70,
        },
        {
            title: '发现时间',
            dataIndex: 'discoveredAt',
            key: 'discoveredAt',
            render: (t: string) => new Date(t).toLocaleTimeString(),
            width: 100,
        },
    ];

    if (loading) {
        return (
            <div style={{ textAlign: 'center', padding: 100 }}>
                <Spin size="large" />
            </div>
        );
    }

    return (
        <div>
            <Title level={3} style={{ color: '#fff', marginBottom: 24 }}>
                🐋 鲸鱼发现
            </Title>

            {/* 控制面板 */}
            <Card style={{ marginBottom: 24, background: '#1f1f1f' }} bordered={false}>
                <Row gutter={[24, 24]} align="middle">
                    <Col>
                        <Space>
                            {status?.running ? (
                                <Button
                                    type="primary"
                                    danger
                                    icon={<PauseOutlined />}
                                    onClick={handleStop}
                                >
                                    停止
                                </Button>
                            ) : (
                                <Button
                                    type="primary"
                                    icon={<PlayCircleOutlined />}
                                    onClick={handleStart}
                                    style={{ background: '#52c41a', borderColor: '#52c41a' }}
                                >
                                    启动
                                </Button>
                            )}
                            <Button icon={<ReloadOutlined />} onClick={loadStatus}>刷新</Button>
                            <Button icon={<SettingOutlined />} onClick={handleOpenConfig}>配置</Button>
                        </Space>
                    </Col>
                    <Col flex={1}>
                        <Space size={48}>
                            <Statistic
                                title={<Text style={{ color: '#888' }}>状态</Text>}
                                value={status?.running ? '运行中' : '已停止'}
                                valueStyle={{ color: status?.running ? '#52c41a' : '#888', fontSize: 16 }}
                                prefix={<Badge status={status?.running ? 'processing' : 'default'} />}
                            />
                            <Statistic
                                title={<Text style={{ color: '#888' }}>运行时间</Text>}
                                value={status?.runtime || '-'}
                                valueStyle={{ fontSize: 16 }}
                            />
                            <Statistic
                                title={<Text style={{ color: '#888' }}>交易观察</Text>}
                                value={status?.tradesObserved?.toLocaleString() || 0}
                                valueStyle={{ fontSize: 16 }}
                            />
                            <Statistic
                                title={<Text style={{ color: '#888' }}>等待分析</Text>}
                                value={status?.queueSize || 0}
                                valueStyle={{ fontSize: 16, color: '#faad14' }}
                            />
                            <Statistic
                                title={<Text style={{ color: '#888' }}>已分析</Text>}
                                value={status?.addressesAnalyzed || 0}
                                valueStyle={{ fontSize: 16 }}
                            />
                            <Statistic
                                title={<Text style={{ color: '#888' }}>发现鲸鱼</Text>}
                                value={status?.whalesDiscovered || 0}
                                valueStyle={{ fontSize: 16, color: '#1890ff' }}
                            />
                        </Space>
                    </Col>
                </Row>
            </Card>
            {/* 鲸鱼列表 */}
            <Card title={
                <Row justify="space-between" align="middle">
                    <Col>已发现鲸鱼 ({whales.length})</Col>
                    <Col>
                        <Space>
                            <Radio.Group
                                value={timePeriod}
                                onChange={(e) => setTimePeriod(e.target.value)}
                                buttonStyle="solid"
                                size="small"
                            >
                                <Radio.Button value="24h">24小时</Radio.Button>
                                <Radio.Button value="7d">7天</Radio.Button>
                                <Radio.Button value="30d">30天</Radio.Button>
                                <Radio.Button value="all">全部</Radio.Button>
                            </Radio.Group>
                            {loadingPeriod && <Spin size="small" />}
                        </Space>
                    </Col>
                </Row>
            } style={{ background: '#1f1f1f' }} bordered={false}>
                {whales.length === 0 ? (
                    <Alert
                        message="暂无发现"
                        description="启动服务后，系统将自动从链上交易中发现潜在的跟单目标。"
                        type="info"
                        showIcon
                    />
                ) : (
                    <Table
                        dataSource={whales}
                        columns={columns}
                        rowKey="address"
                        pagination={{ pageSize: 20 }}
                        size="small"
                    />
                )}
            </Card>

            {/* 配置弹窗 */}
            <Modal
                title="服务配置"
                open={configModalOpen}
                onOk={handleConfigSave}
                onCancel={() => setConfigModalOpen(false)}
            >
                <Form form={form} layout="vertical">
                    <Form.Item
                        name="infuraKey"
                        label="Infura API Key"
                        rules={[{ required: true, message: '请输入 Infura API Key' }]}
                    >
                        <Input.Password placeholder="输入你的 Infura API Key" />
                    </Form.Item>

                    {/* 阶段1: 进入观察队列 */}
                    <div style={{ borderBottom: '1px solid #333', margin: '16px 0 12px', paddingBottom: 4 }}>
                        <Text strong style={{ color: '#faad14' }}>📡 阶段1: 进入观察队列</Text>
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>满足条件才会被分析</Text>
                    </div>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item
                                name="minTradeUsdcValue"
                                label="最小单笔交易金额 ($)"
                                initialValue={50}
                            >
                                <InputNumber min={0} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                name="minTradesObserved"
                                label="最小观察交易次数"
                                initialValue={1}
                            >
                                <InputNumber min={1} max={100} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>

                    {/* 阶段2: 判定为鲸鱼 */}
                    <div style={{ borderBottom: '1px solid #333', margin: '16px 0 12px', paddingBottom: 4 }}>
                        <Text strong style={{ color: '#52c41a' }}>🐋 阶段2: 判定为鲸鱼</Text>
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>必须同时满足以下条件</Text>
                    </div>
                    <Row gutter={16}>
                        <Col span={8}>
                            <Form.Item
                                name="minWinRate"
                                label="最低胜率 (总计)"
                                initialValue={0.55}
                            >
                                <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item
                                name="minPnl"
                                label="最低盈利 (总计 $)"
                                initialValue={1000}
                            >
                                <InputNumber min={0} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item
                                name="minVolume"
                                label="最低交易量 (总计 $)"
                                initialValue={5000}
                            >
                                <InputNumber min={0} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>

                    {/* 调度配置 */}
                    <div style={{ borderBottom: '1px solid #333', margin: '16px 0 12px', paddingBottom: 4 }}>
                        <Text strong style={{ color: '#1890ff' }}>⚙️ 调度配置</Text>
                    </div>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item
                                name="analysisIntervalSec"
                                label="分析间隔 (秒)"
                                initialValue={20}
                            >
                                <InputNumber min={10} max={300} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Alert
                        message="提示"
                        description="修改配置后，如果服务正在运行会立即生效。Infura Key 需要重启服务才能生效。"
                        type="info"
                        showIcon
                        style={{ marginTop: 16 }}
                    />
                </Form>
            </Modal>
        </div>
    );
}

export default WhaleDiscovery;
