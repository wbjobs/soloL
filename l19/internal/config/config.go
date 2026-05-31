package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type ClusterConfig struct {
	Name        string `yaml:"name"`
	SQLHost     string `yaml:"sql_host"`
	SQLPort     int    `yaml:"sql_port"`
	HTTPHost    string `yaml:"http_host"`
	HTTPPort    int    `yaml:"http_port"`
	User        string `yaml:"user"`
	Password    string `yaml:"password,omitempty"`
	Database    string `yaml:"database,omitempty"`
	SSLMode     string `yaml:"ssl_mode,omitempty"`
	CACertPath  string `yaml:"ca_cert_path,omitempty"`
}

type S3Config struct {
	AccessKey  string `yaml:"access_key"`
	SecretKey  string `yaml:"secret_key"`
	Region     string `yaml:"region"`
	Bucket     string `yaml:"bucket"`
	Endpoint   string `yaml:"endpoint,omitempty"`
	PathStyle  bool   `yaml:"path_style,omitempty"`
}

type AppConfig struct {
	DefaultCluster string            `yaml:"default_cluster"`
	Clusters       []ClusterConfig   `yaml:"clusters"`
	S3             *S3Config         `yaml:"s3,omitempty"`
	HealthCheck    HealthCheckConfig `yaml:"health_check,omitempty"`
}

type HealthCheckConfig struct {
	HeartbeatInterval int `yaml:"heartbeat_interval_seconds,omitempty"`
	FailureThreshold  int `yaml:"failure_threshold,omitempty"`
	Timeout           int `yaml:"timeout_seconds,omitempty"`
}

func DefaultConfig() *AppConfig {
	return &AppConfig{
		DefaultCluster: "local",
		Clusters: []ClusterConfig{
			{
				Name:     "local",
				SQLHost:  "localhost",
				SQLPort:  26257,
				HTTPHost: "localhost",
				HTTPPort: 8080,
				User:     "root",
				Database: "defaultdb",
				SSLMode:  "disable",
			},
		},
		HealthCheck: HealthCheckConfig{
			HeartbeatInterval: 5,
			FailureThreshold:  3,
			Timeout:           10,
		},
	}
}

func GetConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user home directory: %w", err)
	}
	return filepath.Join(home, ".dbdoctor", "config.yaml"), nil
}

func Load() (*AppConfig, error) {
	path, err := GetConfigPath()
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, fmt.Errorf("config file not found at %s, please run 'dbdoctor init' to create it", path)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var cfg AppConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	if cfg.HealthCheck.FailureThreshold == 0 {
		cfg.HealthCheck.FailureThreshold = 3
	}
	if cfg.HealthCheck.HeartbeatInterval == 0 {
		cfg.HealthCheck.HeartbeatInterval = 5
	}
	if cfg.HealthCheck.Timeout == 0 {
		cfg.HealthCheck.Timeout = 10
	}

	return &cfg, nil
}

func (c *AppConfig) Save() error {
	path, err := GetConfigPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	header := "# dbdoctor configuration file\n" +
		"# Manage multiple CockroachDB clusters here\n\n"

	output := append([]byte(header), data...)
	if err := os.WriteFile(path, output, 0600); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}

	return nil
}

func (c *AppConfig) GetCluster(name string) (*ClusterConfig, error) {
	if name == "" {
		name = c.DefaultCluster
	}
	for i := range c.Clusters {
		if c.Clusters[i].Name == name {
			return &c.Clusters[i], nil
		}
	}
	return nil, fmt.Errorf("cluster '%s' not found in configuration", name)
}

func (c *AppConfig) ListClusters() []string {
	names := make([]string, len(c.Clusters))
	for i, cluster := range c.Clusters {
		names[i] = cluster.Name
	}
	return names
}
