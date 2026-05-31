package config

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"

	"etcd-config-cli/internal/diff"
	yamlutil "etcd-config-cli/internal/yaml"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
	"golang.org/x/sync/errgroup"
)

var (
	diffPrefixFlag  string
	diffStreamingFlag bool
	diffParallelFlag  int
	diffPageSizeFlag  int64
)

func newDiffCmd(loadClient ClientLoader) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "diff <local_file>...",
		Short: "Diff local YAML file(s) against etcd configuration",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			for _, f := range args {
				if _, err := os.Stat(f); os.IsNotExist(err) {
					return fmt.Errorf("local file does not exist: %s", f)
				}
			}

			ctx := context.Background()
			prefix := diffPrefixFlag
			pageSize := diffPageSizeFlag
			parallel := diffParallelFlag
			if parallel <= 0 {
				parallel = len(args)
			}

			if len(args) == 1 {
				return runSingleDiff(ctx, args[0], prefix, pageSize, diffStreamingFlag, loadClient)
			}

			return runMultiDiff(ctx, args, prefix, pageSize, parallel, loadClient)
		},
	}

	cmd.Flags().StringVarP(&diffPrefixFlag, "prefix", "p", "", "Key prefix for both local and remote comparison")
	cmd.Flags().BoolVar(&diffStreamingFlag, "stream", true, "Use streaming diff to reduce memory usage")
	cmd.Flags().IntVarP(&diffParallelFlag, "parallel", "j", 0, "Number of parallel diff workers (default: number of files)")
	cmd.Flags().Int64Var(&diffPageSizeFlag, "page-size", 1000, "Page size for etcd pagination")

	return cmd
}

func runSingleDiff(ctx context.Context, localFile, prefix string, pageSize int64, streaming bool, loadClient ClientLoader) error {
	client, err := loadClient()
	if err != nil {
		return err
	}
	defer client.Close()

	if !streaming {
		localKV, err := yamlutil.FlattenFile(localFile, prefix)
		if err != nil {
			return fmt.Errorf("parse local YAML: %w", err)
		}

		remoteKV, err := client.GetAllWithPrefix(ctx, prefix)
		if err != nil {
			return fmt.Errorf("fetch etcd config: %w", err)
		}

		changes := diff.Compare(localKV, remoteKV)
		diff.PrintChanges(os.Stdout, changes)
		return nil
	}

	localFactory := func() (diff.KVIterator, error) {
		return yamlutil.NewYAMLIterator(localFile, prefix)
	}
	remoteFactory := func() (diff.KVIterator, error) {
		return client.IteratePrefix(ctx, prefix, pageSize)
	}

	parallelResult, err := diff.LoadIteratorsParallel(ctx, localFactory, remoteFactory)
	if err != nil {
		return fmt.Errorf("load iterators: %w", err)
	}
	defer parallelResult.LocalIt.Close()
	defer parallelResult.RemoteIt.Close()

	hasChanges := false
	handler := func(change diff.Change) error {
		hasChanges = true
		diff.PrintChange(os.Stdout, change)
		return nil
	}

	if err := diff.CompareStreamingFunc(ctx, parallelResult.LocalIt, parallelResult.RemoteIt, handler); err != nil {
		return fmt.Errorf("compare: %w", err)
	}

	if !hasChanges {
		fmt.Fprintln(os.Stdout, color.GreenString("No differences found."))
	}

	return nil
}

func runMultiDiff(ctx context.Context, files []string, prefix string, pageSize int64, parallel int, loadClient ClientLoader) error {
	if parallel > len(files) {
		parallel = len(files)
	}

	client, err := loadClient()
	if err != nil {
		return err
	}
	defer client.Close()

	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(parallel)

	var totalChanges atomic.Int32
	var errorCount atomic.Int32

	for _, f := range files {
		f := f

		g.Go(func() error {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			fileLabel := color.New(color.Bold).Sprintf("=== %s ===", f)
			fmt.Fprintf(os.Stdout, "\n%s\n", fileLabel)

			localFactory := func() (diff.KVIterator, error) {
				return yamlutil.NewYAMLIterator(f, prefix)
			}
			remoteFactory := func() (diff.KVIterator, error) {
				return client.IteratePrefix(ctx, prefix, pageSize)
			}

			parallelResult, err := diff.LoadIteratorsParallel(ctx, localFactory, remoteFactory)
			if err != nil {
				errorCount.Add(1)
				fmt.Fprintf(os.Stderr, "Error loading %s: %v\n", f, err)
				return nil
			}
			defer parallelResult.LocalIt.Close()
			defer parallelResult.RemoteIt.Close()

			fileHasChanges := false
			handler := func(change diff.Change) error {
				fileHasChanges = true
				totalChanges.Add(1)
				diff.PrintChange(os.Stdout, change)
				return nil
			}

			if err := diff.CompareStreamingFunc(ctx, parallelResult.LocalIt, parallelResult.RemoteIt, handler); err != nil {
				errorCount.Add(1)
				fmt.Fprintf(os.Stderr, "Error comparing %s: %v\n", f, err)
				return nil
			}

			if !fileHasChanges {
				fmt.Fprintln(os.Stdout, color.GreenString("No differences found."))
			}

			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return err
	}

	fmt.Fprintf(os.Stdout, "\n%s\n", color.New(color.Bold).Sprint("=== Summary ==="))
	fmt.Fprintf(os.Stdout, "Files checked: %d\n", len(files))
	fmt.Fprintf(os.Stdout, "Total changes: %d\n", totalChanges.Load())
	if errorCount.Load() > 0 {
		fmt.Fprintf(os.Stderr, "Files with errors: %d\n", errorCount.Load())
		return fmt.Errorf("%d files had errors", errorCount.Load())
	}

	return nil
}
