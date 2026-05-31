package etcd

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"time"

	"etcd-config-cli/internal/config"
	"etcd-config-cli/internal/diff"

	clientv3 "go.etcd.io/etcd/client/v3"
	"go.etcd.io/etcd/api/v3/mvccpb"
)

type Client struct {
	*clientv3.Client
}

func NewClient(cfg *config.ClusterConfig) (*Client, error) {
	etcdCfg := clientv3.Config{
		Endpoints:   cfg.Endpoints,
		DialTimeout: 5 * time.Second,
	}

	if cfg.TLSCA != "" || cfg.TLSCert != "" || cfg.TLSKey != "" {
		tlsConfig, err := buildTLSConfig(cfg.TLSCA, cfg.TLSCert, cfg.TLSKey)
		if err != nil {
			return nil, err
		}
		etcdCfg.TLS = tlsConfig
	}

	cli, err := clientv3.New(etcdCfg)
	if err != nil {
		return nil, fmt.Errorf("connect to etcd: %w", err)
	}

	return &Client{Client: cli}, nil
}

func buildTLSConfig(caFile, certFile, keyFile string) (*tls.Config, error) {
	tlsConfig := &tls.Config{}

	if certFile != "" && keyFile != "" {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, fmt.Errorf("load TLS cert/key: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	if caFile != "" {
		caData, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("read CA file: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caData) {
			return nil, fmt.Errorf("parse CA certificate")
		}
		tlsConfig.RootCAs = pool
	}

	return tlsConfig, nil
}

func (c *Client) Get(ctx context.Context, key string, prefix bool) ([]mvccpb.KeyValue, error) {
	var opts []clientv3.OpOption
	if prefix {
		opts = append(opts, clientv3.WithPrefix())
	}

	resp, err := c.Client.Get(ctx, key, opts...)
	if err != nil {
		return nil, err
	}

	kvs := make([]mvccpb.KeyValue, len(resp.Kvs))
	for i, kv := range resp.Kvs {
		kvs[i] = *kv
	}
	return kvs, nil
}

func (c *Client) Set(ctx context.Context, key, value string) error {
	_, err := c.Client.Put(ctx, key, value)
	return err
}

func (c *Client) Watch(ctx context.Context, prefix string) clientv3.WatchChan {
	return c.Client.Watch(ctx, prefix, clientv3.WithPrefix())
}

func (c *Client) GetAllWithPrefix(ctx context.Context, prefix string) (map[string]string, error) {
	resp, err := c.Client.Get(ctx, prefix, clientv3.WithPrefix())
	if err != nil {
		return nil, err
	}

	result := make(map[string]string, len(resp.Kvs))
	for _, kv := range resp.Kvs {
		result[string(kv.Key)] = string(kv.Value)
	}
	return result, nil
}

func (c *Client) IteratePrefix(ctx context.Context, prefix string, pageSize int64) (*EtcdIterator, error) {
	if pageSize <= 0 {
		pageSize = 1000
	}

	end := clientv3.GetPrefixRangeEnd(prefix)

	it := &EtcdIterator{
		client:   c.Client,
		ctx:      ctx,
		prefix:   prefix,
		end:      end,
		lastKey:  prefix,
		pageSize: pageSize,
		buf:      make([]*mvccpb.KeyValue, 0, pageSize),
		done:     false,
	}

	if err := it.fetchNextPage(); err != nil {
		return nil, err
	}

	return it, nil
}

type EtcdIterator struct {
	client   *clientv3.Client
	ctx      context.Context
	prefix   string
	end      string
	lastKey  string
	pageSize int64
	buf      []*mvccpb.KeyValue
	idx      int
	done     bool
}

func (it *EtcdIterator) fetchNextPage() error {
	if it.done {
		return nil
	}

	opts := []clientv3.OpOption{
		clientv3.WithRange(it.end),
		clientv3.WithLimit(it.pageSize),
		clientv3.WithSort(clientv3.SortByKey, clientv3.SortAscend),
	}

	resp, err := it.client.Get(it.ctx, it.lastKey, opts...)
	if err != nil {
		return fmt.Errorf("fetch page: %w", err)
	}

	if len(resp.Kvs) == 0 {
		it.done = true
		return nil
	}

	it.buf = resp.Kvs
	it.idx = 0

	lastKey := string(resp.Kvs[len(resp.Kvs)-1].Key)
	if lastKey == it.lastKey {
		it.done = true
	} else {
		it.lastKey = lastKey
		nextKey := string(append([]byte(lastKey), 0))
		it.lastKey = nextKey
	}

	if len(resp.Kvs) < int(it.pageSize) {
		it.done = true
	}

	return nil
}

func (it *EtcdIterator) Next(ctx context.Context) (*diff.KVPair, error) {
	if it.idx >= len(it.buf) {
		if it.done {
			return nil, nil
		}
		if err := it.fetchNextPage(); err != nil {
			return nil, err
		}
		if it.idx >= len(it.buf) {
			return nil, nil
		}
	}

	kv := it.buf[it.idx]
	it.idx++

	return &diff.KVPair{
		Key:   string(kv.Key),
		Value: string(kv.Value),
	}, nil
}

func (it *EtcdIterator) Close() error {
	it.done = true
	it.buf = nil
	return nil
}
