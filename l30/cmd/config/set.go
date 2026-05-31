package config

import (
	"context"
	"fmt"

	"etcd-config-cli/internal/crypto"
	"etcd-config-cli/internal/versioning"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var (
	setNoSnapshotFlag bool
	setNoEncryptFlag  bool
)

func newSetCmd(loadClient ClientLoader) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "set <key> <value>",
		Short: "Set a configuration key-value pair",
		Args:  cobra.ExactArgs(2),
		RunE: func(c *cobra.Command, args []string) error {
			key := args[0]
			value := args[1]

			client, err := loadClient()
			if err != nil {
				return err
			}
			defer client.Close()

			ctx := context.Background()

			prevResp, _ := client.Get(ctx, key, false)
			prevValue := ""
			if len(prevResp) > 0 {
				prevValue = string(prevResp[0].Value)
			}

			finalValue := value
			encrypted := false
			if !setNoEncryptFlag && crypto.HasEncryptionKey() {
				if crypto.IsSensitiveKey(key) {
					finalValue, encrypted = crypto.EncryptIfSensitive(key, value)
				}
			}

			if err := client.Set(ctx, key, finalValue); err != nil {
				return err
			}

			if encrypted {
				fmt.Printf("%s %s = %s\n", color.GreenString("[SET]"), key, color.YellowString("[encrypted]"))
			} else {
				fmt.Printf("%s %s = %s\n", color.GreenString("[SET]"), key, finalValue)
			}

			if !setNoSnapshotFlag {
				snap, err := versioning.CreateSnapshot(ctx, client.Client, key, finalValue, prevValue)
				if err != nil {
					fmt.Printf("%s failed to create snapshot: %v\n", color.YellowString("[WARN]"), err)
				} else {
					fmt.Printf("%s snapshot v%d saved (operator: %s)\n", color.CyanString("[INFO]"), snap.Version, snap.Operator)
				}
			}

			return nil
		},
	}

	cmd.Flags().BoolVar(&setNoSnapshotFlag, "no-snapshot", false, "Skip creating version snapshot")
	cmd.Flags().BoolVar(&setNoEncryptFlag, "no-encrypt", false, "Skip automatic encryption of sensitive values")

	return cmd
}
