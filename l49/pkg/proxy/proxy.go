package proxy

import (
	"crypto-proxy/pkg/crypto"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

type Proxy struct {
	cryptoEngine   *crypto.RC4Engine
	typedCodec     *crypto.TypedCodec
	metadataMgr    *crypto.MetadataManager
	parser         *SQLParser
	defaultSchema  string
}

func NewProxy(cryptoEngine *crypto.RC4Engine, metadataMgr *crypto.MetadataManager, defaultSchema string) *Proxy {
	return &Proxy{
		cryptoEngine:  cryptoEngine,
		typedCodec:    crypto.NewTypedCodec(cryptoEngine),
		metadataMgr:   metadataMgr,
		parser:        NewSQLParser(),
		defaultSchema: defaultSchema,
	}
}

func (p *Proxy) ProcessQuery(sql string) (string, error) {
	parsed := p.parser.Parse(sql)

	switch parsed.Type {
	case QueryInsert:
		return p.processInsert(parsed)
	case QuerySelect:
		return p.processSelect(parsed)
	case QueryUpdate:
		return p.processUpdate(parsed)
	default:
		return sql, nil
	}
}

func (p *Proxy) processInsert(parsed *ParsedQuery) (string, error) {
	schema := parsed.Schema
	if schema == "" {
		schema = p.defaultSchema
	}

	encryptedValues := make([][]string, len(parsed.Values))
	for i := range parsed.Values {
		encryptedValues[i] = make([]string, len(parsed.Columns))
		copy(encryptedValues[i], parsed.Values[i])
	}

	for colIdx, column := range parsed.Columns {
		if p.metadataMgr.IsColumnEncrypted(schema, parsed.TableName, column) {
			config, _ := p.metadataMgr.GetColumn(schema, parsed.TableName, column)
			
			for rowIdx := range parsed.Values {
				originalValue := parsed.Values[rowIdx][colIdx]
				trimmedValue := strings.Trim(originalValue, "'\"")
				if trimmedValue != "NULL" && trimmedValue != "" {
					encrypted, err := p.typedCodec.EncryptTyped(originalValue, config.KeyVersion, config.ColumnType)
					if err != nil {
						return "", fmt.Errorf("encryption failed for column %s: %w", column, err)
					}
					encryptedValues[rowIdx][colIdx] = "X'" + hex.EncodeToString(encrypted) + "'"
				}
			}
		}
	}

	return p.rebuildInsert(parsed, encryptedValues), nil
}

func (p *Proxy) processSelect(parsed *ParsedQuery) (string, error) {
	return parsed.Raw, nil
}

func (p *Proxy) processUpdate(parsed *ParsedQuery) (string, error) {
	schema := parsed.Schema
	if schema == "" {
		schema = p.defaultSchema
	}

	setClauses := make([]string, 0, len(parsed.Columns))
	
	for i, column := range parsed.Columns {
		value := parsed.Values[0][i]
		
		if p.metadataMgr.IsColumnEncrypted(schema, parsed.TableName, column) {
			config, _ := p.metadataMgr.GetColumn(schema, parsed.TableName, column)
			trimmedValue := strings.Trim(value, "'\"")
			
			if trimmedValue != "NULL" && trimmedValue != "" {
				encrypted, err := p.typedCodec.EncryptTyped(value, config.KeyVersion, config.ColumnType)
				if err != nil {
					return "", fmt.Errorf("encryption failed for column %s: %w", column, err)
				}
				value = "X'" + hex.EncodeToString(encrypted) + "'"
			}
		}
		
		setClauses = append(setClauses, fmt.Sprintf("`%s` = %s", column, value))
	}

	whereClause := ""
	if len(parsed.Where) > 0 {
		whereParts := make([]string, 0, len(parsed.Where))
		for k, v := range parsed.Where {
			whereParts = append(whereParts, fmt.Sprintf("`%s` = %s", k, v))
		}
		whereClause = " WHERE " + strings.Join(whereParts, " AND ")
	}

	tableRef := parsed.TableName
	if schema != "" {
		tableRef = fmt.Sprintf("`%s`.`%s`", schema, parsed.TableName)
	}

	return fmt.Sprintf("UPDATE %s SET %s%s", tableRef, strings.Join(setClauses, ", "), whereClause), nil
}

func (p *Proxy) rebuildInsert(parsed *ParsedQuery, values [][]string) string {
	schema := parsed.Schema
	if schema == "" {
		schema = p.defaultSchema
	}

	tableRef := parsed.TableName
	if schema != "" {
		tableRef = fmt.Sprintf("`%s`.`%s`", schema, parsed.TableName)
	}

	columns := make([]string, len(parsed.Columns))
	for i, col := range parsed.Columns {
		columns[i] = "`" + col + "`"
	}

	valueStrs := make([]string, len(values))
	for i, row := range values {
		valueStrs[i] = "(" + strings.Join(row, ", ") + ")"
	}

	return fmt.Sprintf("INSERT INTO %s (%s) VALUES %s",
		tableRef,
		strings.Join(columns, ", "),
		strings.Join(valueStrs, ", "))
}

func (p *Proxy) DecryptResult(columnName string, schema, table string, value []byte) (string, error) {
	if schema == "" {
		schema = p.defaultSchema
	}

	if !p.metadataMgr.IsColumnEncrypted(schema, table, columnName) {
		return string(value), nil
	}

	if len(value) == 0 {
		return "", nil
	}

	if len(value) < 5 {
		return string(value), nil
	}

	tv, err := p.typedCodec.DecryptTyped(value)
	if err != nil {
		return "", fmt.Errorf("decryption failed: %w", err)
	}

	return p.typedCodec.FormatValue(tv), nil
}

func (p *Proxy) DecryptTyped(columnName string, schema, table string, value []byte) (*crypto.TypedValue, error) {
	if schema == "" {
		schema = p.defaultSchema
	}

	if !p.metadataMgr.IsColumnEncrypted(schema, table, columnName) {
		return &crypto.TypedValue{Type: crypto.TypeString, Value: string(value)}, nil
	}

	if len(value) == 0 {
		return nil, errors.New("empty value")
	}

	if len(value) < 5 {
		return &crypto.TypedValue{Type: crypto.TypeBytes, Value: value}, nil
	}

	return p.typedCodec.DecryptTyped(value)
}

func (p *Proxy) DecryptHexString(columnName string, schema, table, hexValue string) (string, error) {
	if schema == "" {
		schema = p.defaultSchema
	}

	if !p.metadataMgr.IsColumnEncrypted(schema, table, columnName) {
		return hexValue, nil
	}

	bytes, err := hex.DecodeString(strings.TrimPrefix(strings.ToLower(hexValue), "0x"))
	if err != nil {
		trimmed := strings.Trim(hexValue, "X'x'")
		bytes, err = hex.DecodeString(trimmed)
		if err != nil {
			return "", errors.New("invalid hex value")
		}
	}

	return p.DecryptResult(columnName, schema, table, bytes)
}

func (p *Proxy) DecryptHexTyped(columnName string, schema, table, hexValue string) (*crypto.TypedValue, error) {
	if schema == "" {
		schema = p.defaultSchema
	}

	bytes, err := hex.DecodeString(strings.TrimPrefix(strings.ToLower(hexValue), "0x"))
	if err != nil {
		trimmed := strings.Trim(hexValue, "X'x'")
		bytes, err = hex.DecodeString(trimmed)
		if err != nil {
			return nil, errors.New("invalid hex value")
		}
	}

	return p.DecryptTyped(columnName, schema, table, bytes)
}

func (p *Proxy) GetEncryptedColumns(schema, table string) []string {
	if schema == "" {
		schema = p.defaultSchema
	}

	allColumns := p.metadataMgr.GetAllColumns()
	result := make([]string, 0)
	
	for _, col := range allColumns {
		if col.TableSchema == schema && col.TableName == table && col.Enabled {
			result = append(result, col.ColumnName)
		}
	}
	
	return result
}

func (p *Proxy) GetEncryptedColumnsWithType(schema, table string) map[string]crypto.DataType {
	if schema == "" {
		schema = p.defaultSchema
	}

	allColumns := p.metadataMgr.GetAllColumns()
	result := make(map[string]crypto.DataType)
	
	for _, col := range allColumns {
		if col.TableSchema == schema && col.TableName == table && col.Enabled {
			result[col.ColumnName] = col.ColumnType
		}
	}
	
	return result
}

func (p *Proxy) GetCryptoEngine() *crypto.RC4Engine {
	return p.cryptoEngine
}

func (p *Proxy) GetTypedCodec() *crypto.TypedCodec {
	return p.typedCodec
}

func (p *Proxy) GetMetadataManager() *crypto.MetadataManager {
	return p.metadataMgr
}
