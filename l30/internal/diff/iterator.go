package diff

import (
	"context"
	"sort"
)

type KVPair struct {
	Key   string
	Value string
}

type KVIterator interface {
	Next(ctx context.Context) (*KVPair, error)
	Close() error
}

type MapIterator struct {
	keys   []string
	values map[string]string
	idx    int
}

func NewMapIterator(m map[string]string) *MapIterator {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return &MapIterator{
		keys:   keys,
		values: m,
		idx:    0,
	}
}

func (it *MapIterator) Next(ctx context.Context) (*KVPair, error) {
	if it.idx >= len(it.keys) {
		return nil, nil
	}
	key := it.keys[it.idx]
	it.idx++
	return &KVPair{
		Key:   key,
		Value: it.values[key],
	}, nil
}

func (it *MapIterator) Close() error {
	return nil
}

type ChannelIterator struct {
	ch   chan *KVPair
	err  error
	done chan struct{}
}

func NewChannelIterator(bufferSize int) (*ChannelIterator, chan<- *KVPair, chan<- error) {
	ch := make(chan *KVPair, bufferSize)
	errCh := make(chan error, 1)
	done := make(chan struct{})

	it := &ChannelIterator{
		ch:   ch,
		done: done,
	}

	go func() {
		select {
		case <-done:
		case err := <-errCh:
			it.err = err
			close(ch)
		}
	}()

	return it, ch, errCh
}

func (it *ChannelIterator) Next(ctx context.Context) (*KVPair, error) {
	if it.err != nil {
		return nil, it.err
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case kv, ok := <-it.ch:
		if !ok {
			return nil, it.err
		}
		return kv, nil
	}
}

func (it *ChannelIterator) Close() error {
	close(it.done)
	return nil
}
