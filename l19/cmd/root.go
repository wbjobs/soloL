package cmd

import (
	"fmt"
	"os"

	"dbdoctor/internal/config"

	"github.com/spf13/cobra"
)

var (
	cfgFile     string
	clusterName string
	jsonOutput  bool
)

var rootCmd = &cobra.Command{
	Use:   "dbdoctor",
	Short: "CockroachDB集群管理工具",
	Long: `dbdoctor是一个CockroachDB分布式集群管理工具，支持节点状态查看、
负载均衡、备份恢复等功能。通过HTTP API和SQL接口与集群交互。`,
	Version: "1.0.0",
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	cobra.OnInitialize(initConfig)
	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.dbdoctor/config.yaml)")
	rootCmd.PersistentFlags().StringVarP(&clusterName, "cluster", "c", "", "cluster name to operate on")
	rootCmd.PersistentFlags().BoolVar(&jsonOutput, "json", false, "output in JSON format")
	rootCmd.CompletionOptions.DisableDefaultCmd = false
	rootCmd.SetHelpCommand(&cobra.Command{Hidden: true})
}

func initConfig() {
	if cfgFile != "" {
		os.Setenv("DBDOCTOR_CONFIG", cfgFile)
	}
}

func loadConfig() (*config.AppConfig, error) {
	return config.Load()
}

func getCluster(cfg *config.AppConfig) (*config.ClusterConfig, error) {
	return cfg.GetCluster(clusterName)
}
