package cmd

import (
	"bytes"
	"fmt"
	"os"

	etcdcli "etcd-config-cli/cmd/config"
	appconfig "etcd-config-cli/internal/config"
	etcdclient "etcd-config-cli/internal/etcd"

	"github.com/BurntSushi/toml"
	"github.com/spf13/cobra"
)

var (
	cfgFile     string
	clusterFlag string
)

var rootCmd = &cobra.Command{
	Use:   "etcdctl",
	Short: "etcd configuration management CLI",
	Long:  "A CLI tool for managing etcd configurations with multi-cluster support, TLS, and diff capabilities.",
}

func Execute() error {
	return rootCmd.Execute()
}

func init() {
	cobra.OnInitialize()

	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.config/cli/config.toml)")
	rootCmd.PersistentFlags().StringVar(&clusterFlag, "cluster", "", "cluster name to use (overrides current_cluster in config)")

	rootCmd.AddCommand(etcdcli.NewConfigCmd(LoadEtcdClient))
	rootCmd.AddCommand(newClusterCmd())
	rootCmd.AddCommand(newContextCmd())
}

func LoadEtcdClient() (*etcdclient.Client, error) {
	appCfg, err := appconfig.LoadConfig(cfgFile)
	if err != nil {
		return nil, err
	}

	if clusterFlag != "" {
		if _, ok := appCfg.Clusters[clusterFlag]; !ok {
			return nil, fmt.Errorf("cluster %q not found in config", clusterFlag)
		}
		appCfg.CurrentCluster = clusterFlag
	}

	clusterCfg, err := appCfg.GetCurrentCluster()
	if err != nil {
		return nil, err
	}

	return etcdclient.NewClient(clusterCfg)
}

func newClusterCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "clusters",
		Short: "List configured clusters",
		RunE: func(cmd *cobra.Command, args []string) error {
			appCfg, err := appconfig.LoadConfig(cfgFile)
			if err != nil {
				return err
			}

			fmt.Printf("Current cluster: %s\n\n", appCfg.CurrentCluster)
			fmt.Println("Available clusters:")
			for name := range appCfg.Clusters {
				marker := " "
				if name == appCfg.CurrentCluster {
					marker = "*"
				}
				fmt.Printf("  %s %s\n", marker, name)
			}
			return nil
		},
	}
	return cmd
}

func newContextCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "use <cluster>",
		Short: "Switch current cluster",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			clusterName := args[0]
			path := cfgFile
			if path == "" {
				var err error
				path, err = appconfig.DefaultConfigPath()
				if err != nil {
					return err
				}
			}

			data, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("read config file: %w", err)
			}

			content := string(data)
			var cfg appconfig.AppConfig
			if _, err := toml.Decode(content, &cfg); err != nil {
				return fmt.Errorf("parse config: %w", err)
			}

			if _, ok := cfg.Clusters[clusterName]; !ok {
				return fmt.Errorf("cluster %q not found", clusterName)
			}

			cfg.CurrentCluster = clusterName

			var buf bytes.Buffer
			if err := toml.NewEncoder(&buf).Encode(cfg); err != nil {
				return fmt.Errorf("encode config: %w", err)
			}

			if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
				return fmt.Errorf("write config: %w", err)
			}

			fmt.Printf("Switched to cluster: %s\n", clusterName)
			return nil
		},
	}
	return cmd
}
