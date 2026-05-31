package diff

import (
	"context"
	"fmt"
	"sync"

	"golang.org/x/sync/errgroup"
)

type ParallelIterator struct {
	iterators []KVIterator
	results   []chan *KVPair
	errs      []error
	mu        sync.Mutex
}

func NewParallelIterator(ctx context.Context, factories []func() (KVIterator, error), bufferSize int) (*ParallelIterator, error) {
	if bufferSize <= 0 {
		bufferSize = 100
	}

	pi := &ParallelIterator{
		iterators: make([]KVIterator, len(factories)),
		results:   make([]chan *KVPair, len(factories)),
		errs:      make([]error, len(factories)),
	}

	g, ctx := errgroup.WithContext(ctx)

	for i, factory := range factories {
		i := i
		factory := factory
		pi.results[i] = make(chan *KVPair, bufferSize)

		g.Go(func() error {
			it, err := factory()
			if err != nil {
				pi.mu.Lock()
				pi.errs[i] = fmt.Errorf("iterator %d: %w", i, err)
				pi.mu.Unlock()
				close(pi.results[i])
				return err
			}

			pi.mu.Lock()
			pi.iterators[i] = it
			pi.mu.Unlock()

			defer func() {
				it.Close()
				close(pi.results[i])
			}()

			for {
				kv, err := it.Next(ctx)
				if err != nil {
					pi.mu.Lock()
					pi.errs[i] = err
					pi.mu.Unlock()
					return err
				}
				if kv == nil {
					return nil
				}

				select {
				case <-ctx.Done():
					return ctx.Err()
				case pi.results[i] <- kv:
				}
			}
		})
	}

	go func() {
		g.Wait()
	}()

	return pi, nil
}

func (pi *ParallelIterator) GetResultChannel(idx int) <-chan *KVPair {
	return pi.results[idx]
}

func (pi *ParallelIterator) GetError(idx int) error {
	pi.mu.Lock()
	defer pi.mu.Unlock()
	return pi.errs[idx]
}

func (pi *ParallelIterator) Close() error {
	pi.mu.Lock()
	defer pi.mu.Unlock()

	var firstErr error
	for _, it := range pi.iterators {
		if it != nil {
			if err := it.Close(); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

type ParallelDiffResult struct {
	LocalIt  KVIterator
	RemoteIt KVIterator
}

func LoadIteratorsParallel(ctx context.Context,
	localFactory func() (KVIterator, error),
	remoteFactory func() (KVIterator, error),
) (*ParallelDiffResult, error) {
	pi, err := NewParallelIterator(ctx, []func() (KVIterator, error){
		localFactory,
		remoteFactory,
	}, 100)
	if err != nil {
		return nil, err
	}

	localCh := pi.GetResultChannel(0)
	remoteCh := pi.GetResultChannel(1)

	localIt := &channelBackedIterator{
		ch:   localCh,
		done: make(chan struct{}),
	}
	remoteIt := &channelBackedIterator{
		ch:   remoteCh,
		done: make(chan struct{}),
	}

	go func() {
		<-localIt.done
		<-remoteIt.done
		pi.Close()
	}()

	return &ParallelDiffResult{
		LocalIt:  localIt,
		RemoteIt: remoteIt,
	}, nil
}

type channelBackedIterator struct {
	ch   <-chan *KVPair
	done chan struct{}
	err  error
}

func (it *channelBackedIterator) Next(ctx context.Context) (*KVPair, error) {
	if it.err != nil {
		return nil, it.err
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case kv, ok := <-it.ch:
		if !ok {
			return nil, nil
		}
		return kv, nil
	}
}

func (it *channelBackedIterator) Close() error {
	close(it.done)
	return nil
}
