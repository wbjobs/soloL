package config

import (
	"context"
	"fmt"
	"os"
	"text/tabwriter"

	"etcd-config-cli/internal/versioning"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var historyLimitFlag int

func newHistoryCmd(loadClient ClientLoader) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "history <key>",
		Short: "Show version history for a configuration key",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			key := args[0]

			client, err := loadClient()
			if err != nil {
				return err
			}
			defer client.Close()

			ctx := context.Background()

			entries, err := versioning.GetHistory(ctx, client.Client, key, historyLimitFlag)
			if err != nil {
				return err
			}

			if len(entries) == 0 {
				fmt.Printf("No history found for key %q\n", key)
				return nil
			}

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "VERSION\tTIMESTAMP\tOPERATOR\tACTION\tCHANGE")
			fmt.Fprintln(w, "-------\t---------\t--------\t------\t------")

			for _, entry := range entries {
				actionColor := color.GreenString(entry.Action)
				if entry.Action == "rollback" {
					actionColor = color.CyanString(entry.Action)
				}

				fmt.Fprintf(w, "v%d\t%s\t%s\t%s\t%s\n",
					entry.Version,
					entry.Timestamp.Format("2006-01-02 15:04:05"),
					entry.Operator,
					actionColor,
					entry.Change)
			}

			w.Flush()
			return nil
		},
	}

	cmd.Flags().IntVarP(&historyLimitFlag, "limit", "n", 20, "Limit number of history entries (0 for all)")

	return cmd
}
