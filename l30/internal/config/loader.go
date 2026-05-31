package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

type ClusterConfig struct {
	Endpoints []string `toml:"endpoints"`
	TLSCA     string   `toml:"tls_ca"`
	TLSCert   string   `toml:"tls_cert"`
	TLSKey    string   `toml:"tls_key"`
}

type AppConfig struct {
	CurrentCluster string                    `toml:"current_cluster"`
	Clusters       map[string]*ClusterConfig `toml:"clusters"`
}

func DefaultConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "cli", "config.toml"), nil
}

func LoadConfig(path string) (*AppConfig, error) {
	if path == "" {
		var err error
		path, err = DefaultConfigPath()
		if err != nil {
			return nil, err
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config file %s: %w", path, err)
	}

	var cfg AppConfig
	if _, err := toml.Decode(string(data), &cfg); err != nil {
		return nil, fmt.Errorf("parse config file: %w", err)
	}

	if cfg.CurrentCluster == "" {
		return nil, fmt.Errorf("current_cluster not set in config")
	}

	if _, ok := cfg.Clusters[cfg.CurrentCluster]; !ok {
		return nil, fmt.Errorf("current_cluster %q not found in clusters", cfg.CurrentCluster)
	}

	return &cfg, nil
}

func (c *AppConfig) GetCurrentCluster() (*ClusterConfig, error) {
	cluster, ok := c.Clusters[c.CurrentCluster]
	if !ok {
		return nil, fmt.Errorf("cluster %q not found", c.CurrentCluster)
	}
	return cluster, nil
}
