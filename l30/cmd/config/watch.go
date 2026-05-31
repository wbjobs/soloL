package config

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/fatih/color"
	clientv3 "go.etcd.io/etcd/client/v3"
	"github.com/spf13/cobra"
)

func newWatchCmd(loadClient ClientLoader) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "watch <prefix>",
		Short: "Watch for configuration changes under a prefix",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			prefix := args[0]

			client, err := loadClient()
			if err != nil {
				return err
			}
			defer client.Close()

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
			go func() {
				<-sigCh
				fmt.Println("\nStopping watch...")
				cancel()
			}()

			fmt.Printf("Watching for changes under prefix: %s\n", prefix)
			fmt.Println("Press Ctrl+C to stop")
			fmt.Println()

			watchChan := client.Watch(ctx, prefix)

			green := color.New(color.FgGreen).SprintFunc()
			red := color.New(color.FgRed).SprintFunc()
			yellow := color.New(color.FgYellow).SprintFunc()

			for resp := range watchChan {
				if resp.Err() != nil {
					fmt.Printf("Watch error: %v\n", resp.Err())
					continue
				}

				for _, ev := range resp.Events {
					key := string(ev.Kv.Key)
					value := string(ev.Kv.Value)

					switch ev.Type {
					case clientv3.EventTypePut:
						if ev.IsCreate() {
							fmt.Printf("%s %s = %s\n", green("[PUT]  "), key, value)
						} else {
							fmt.Printf("%s %s = %s\n", yellow("[UPDATE]"), key, value)
						}
					case clientv3.EventTypeDelete:
						fmt.Printf("%s %s\n", red("[DELETE]"), key)
					}
				}
			}

			return nil
		},
	}

	return cmd
}
