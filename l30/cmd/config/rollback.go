package config

import (
	"context"
	"fmt"
	"strconv"

	"etcd-config-cli/internal/crypto"
	"etcd-config-cli/internal/versioning"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var rollbackDryRunFlag bool

func newRollbackCmd(loadClient ClientLoader) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "rollback <key> --version <num>",
		Short: "Rollback a configuration key to a previous version",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			key := args[0]
			versionStr := c.Flag("version").Value.String()
			version, err := strconv.Atoi(versionStr)
			if err != nil {
				return fmt.Errorf("invalid version number: %s", versionStr)
			}

			client, err := loadClient()
			if err != nil {
				return err
			}
			defer client.Close()

			ctx := context.Background()

			snapshot, err := versioning.GetSnapshot(ctx, client.Client, key, version)
			if err != nil {
				return err
			}

			if rollbackDryRunFlag {
				fmt.Printf("%s would rollback %s to v%d:\n", color.YellowString("[DRY RUN]"), key, version)

				value := snapshot.Value
				if crypto.IsEncrypted(value) {
					if decrypted, ok := crypto.TryDecrypt(value); ok {
						fmt.Printf("  Value (decrypted): %s\n", decrypted)
					} else {
						fmt.Printf("  Value: [encrypted]\n")
					}
				} else {
					fmt.Printf("  Value: %s\n", value)
				}
				fmt.Printf("  Original timestamp: %s\n", snapshot.Timestamp.Format("2006-01-02 15:04:05"))
				fmt.Printf("  Original operator: %s\n", snapshot.Operator)
				return nil
			}

			rollbackSnap, err := versioning.RollbackToVersion(ctx, client.Client, key, version)
			if err != nil {
				return fmt.Errorf("rollback failed: %w", err)
			}

			fmt.Printf("%s rolled back %s to v%d (new snapshot: v%d)\n",
				color.GreenString("[ROLLBACK]"),
				key,
				version,
				rollbackSnap.Version)

			return nil
		},
	}

	cmd.Flags().Int("version", 0, "Version number to rollback to (required)")
	cmd.Flags().BoolVar(&rollbackDryRunFlag, "dry-run", false, "Show what would be rolled back without making changes")
	cmd.MarkFlagRequired("version")

	return cmd
}
