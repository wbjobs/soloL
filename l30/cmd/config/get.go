package config

import (
	"context"
	"fmt"

	"etcd-config-cli/internal/crypto"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var (
	prefixFlag    bool
	getRawFlag    bool
)

func newGetCmd(loadClient ClientLoader) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "get <key>",
		Short: "Get configuration value(s) by key",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			key := args[0]

			client, err := loadClient()
			if err != nil {
				return err
			}
			defer client.Close()

			ctx := context.Background()
			kvs, err := client.Get(ctx, key, prefixFlag)
			if err != nil {
				return err
			}

			if len(kvs) == 0 {
				fmt.Printf("No keys found matching %q\n", key)
				return nil
			}

			for _, kv := range kvs {
				value := string(kv.Value)
				keyStr := string(kv.Key)

				if !getRawFlag {
					if decrypted, ok := crypto.TryDecrypt(value); ok {
						fmt.Printf("%s = %s %s\n", keyStr, decrypted, color.CyanString("[decrypted]"))
						continue
					}
				}

				if crypto.IsEncrypted(value) {
					fmt.Printf("%s = %s\n", keyStr, color.YellowString("[encrypted]"))
				} else {
					fmt.Printf("%s = %s\n", keyStr, value)
				}
			}

			return nil
		},
	}

	cmd.Flags().BoolVarP(&prefixFlag, "prefix", "p", false, "Treat key as prefix for range query")
	cmd.Flags().BoolVar(&getRawFlag, "raw", false, "Show raw encrypted values without decryption")

	return cmd
}
