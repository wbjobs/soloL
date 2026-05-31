#pragma once
#include <map>
#include <vector>
#include <string>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <cctype>
#include <stdexcept>

namespace nlohmann {

class json {
public:
    enum value_t { null, boolean, number, string, array, object };

    json() : type_(null) {}
    json(bool b) : type_(boolean), bool_val_(b) {}
    json(int v) : type_(number), num_val_(static_cast<double>(v)) {}
    json(double v) : type_(number), num_val_(v) {}
    json(const char* s) : type_(string), str_val_(s) {}
    json(const std::string& s) : type_(string), str_val_(s) {}

    static json parse(const std::string& s) {
        json j;
        size_t pos = 0;
        j.parse_impl(s, pos);
        return j;
    }

    bool is_number() const { return type_ == number; }
    bool is_string() const { return type_ == string; }
    bool is_boolean() const { return type_ == boolean; }
    bool is_object() const { return type_ == object; }
    bool is_array() const { return type_ == array; }
    bool is_number_integer() const { return type_ == number; }
    bool is_number_float() const { return type_ == number; }

    json& operator[](const std::string& key) {
        type_ = object;
        return obj_val_[key];
    }
    const json& operator[](const std::string& key) const {
        static json null_json;
        auto it = obj_val_.find(key);
        return it != obj_val_.end() ? it->second : null_json;
    }

    json& operator[](size_t idx) {
        type_ = array;
        if (idx >= arr_val_.size()) arr_val_.resize(idx + 1);
        return arr_val_[idx];
    }

    template<typename T>
    T get() const { return static_cast<T>(num_val_); }
    template<> bool get() const { return bool_val_; }
    template<> std::string get() const { return str_val_; }
    template<> int get() const { return static_cast<int>(num_val_); }
    template<> float get() const { return static_cast<float>(num_val_); }
    template<> double get() const { return num_val_; }

    bool contains(const std::string& key) const {
        return obj_val_.find(key) != obj_val_.end();
    }

    std::string dump(int indent = -1) const {
        std::ostringstream oss;
        dump_impl(oss, indent, 0);
        return oss.str();
    }

    size_t size() const {
        if (type_ == array) return arr_val_.size();
        if (type_ == object) return obj_val_.size();
        return 0;
    }

    auto begin() { return arr_val_.begin(); }
    auto end() { return arr_val_.end(); }
    auto begin() const { return arr_val_.begin(); }
    auto end() const { return arr_val_.end(); }

    class iterator {
    public:
        using iterator_category = std::forward_iterator_tag;
        using value_type = std::pair<std::string, json>;
        using MapIter = std::map<std::string, json>::iterator;
        using VecIter = std::vector<json>::iterator;

        iterator(MapIter it) : map_it_(it), is_map_(true) {}
        iterator(VecIter vit, size_t idx) : vec_it_(vit), vec_idx_(idx), is_map_(false) {}

        std::string key() const { return is_map_ ? map_it_->first : std::to_string(vec_idx_); }
        json& value() { return is_map_ ? map_it_->second : *vec_it_; }

        bool operator!=(const iterator& other) const {
            if (is_map_ != other.is_map_) return true;
            return is_map_ ? map_it_ != other.map_it_ : vec_it_ != other.vec_it_;
        }
        iterator& operator++() {
            if (is_map_) ++map_it_;
            else { ++vec_it_; ++vec_idx_; }
            return *this;
        }
        std::pair<const std::string, json> operator*() {
            return is_map_ ? *map_it_ : std::make_pair(std::to_string(vec_idx_), *vec_it_);
        }

    private:
        MapIter map_it_;
        VecIter vec_it_;
        size_t vec_idx_ = 0;
        bool is_map_;
    };

private:
    void skip_ws(const std::string& s, size_t& pos) {
        while (pos < s.size() && std::isspace(static_cast<unsigned char>(s[pos]))) pos++;
    }

    void parse_impl(const std::string& s, size_t& pos) {
        skip_ws(s, pos);
        if (pos >= s.size()) return;
        char c = s[pos];
        if (c == 'n') { pos += 4; type_ = null; }
        else if (c == 't') { pos += 4; type_ = boolean; bool_val_ = true; }
        else if (c == 'f') { pos += 5; type_ = boolean; bool_val_ = false; }
        else if (c == '"') {
            type_ = string; pos++;
            while (pos < s.size() && s[pos] != '"') {
                if (s[pos] == '\\' && pos + 1 < s.size()) pos++;
                str_val_ += s[pos++];
            }
            pos++;
        } else if (c == '{' || c == '[') {
            char end = (c == '{') ? '}' : ']';
            type_ = (c == '{') ? object : array;
            pos++;
            while (pos < s.size()) {
                skip_ws(s, pos);
                if (pos >= s.size() || s[pos] == end) break;
                if (s[pos] == ',') { pos++; continue; }
                if (type_ == object) {
                    json key; key.parse_impl(s, pos);
                    skip_ws(s, pos);
                    if (pos < s.size() && s[pos] == ':') pos++;
                    json val; val.parse_impl(s, pos);
                    obj_val_[key.str_val_] = val;
                } else {
                    json val; val.parse_impl(s, pos);
                    arr_val_.push_back(val);
                }
            }
            if (pos < s.size()) pos++;
        } else {
            type_ = number;
            size_t start = pos;
            if (s[pos] == '-' || s[pos] == '+') pos++;
            while (pos < s.size() && (std::isdigit(static_cast<unsigned char>(s[pos])) || s[pos] == '.' || s[pos] == 'e' || s[pos] == 'E' || s[pos] == '-' || s[pos] == '+')) pos++;
            num_val_ = std::stod(s.substr(start, pos - start));
        }
    }

    void dump_impl(std::ostringstream& oss, int indent, int level) const {
        std::string sp(indent > 0 ? level * indent : 0, ' ');
        std::string nl = indent > 0 ? "\n" : "";
        switch (type_) {
            case null: oss << "null"; break;
            case boolean: oss << (bool_val_ ? "true" : "false"); break;
            case number: oss << num_val_; break;
            case string: oss << '"' << str_val_ << '"'; break;
            case array:
                oss << '[' << nl;
                for (size_t i = 0; i < arr_val_.size(); ++i) {
                    if (i) oss << ',' << nl;
                    if (indent > 0) oss << std::string((level + 1) * indent, ' ');
                    arr_val_[i].dump_impl(oss, indent, level + 1);
                }
                if (!arr_val_.empty() && indent > 0) oss << nl << sp;
                oss << ']';
                break;
            case object:
                oss << '{' << nl;
                size_t i = 0;
                for (const auto& p : obj_val_) {
                    if (i++) oss << ',' << nl;
                    if (indent > 0) oss << std::string((level + 1) * indent, ' ');
                    oss << '"' << p.first << "\":" << (indent > 0 ? " " : "");
                    p.second.dump_impl(oss, indent, level + 1);
                }
                if (!obj_val_.empty() && indent > 0) oss << nl << sp;
                oss << '}';
                break;
        }
    }

    value_t type_;
    bool bool_val_ = false;
    double num_val_ = 0.0;
    std::string str_val_;
    std::vector<json> arr_val_;
    std::map<std::string, json> obj_val_;

    friend std::istream& operator>>(std::istream& is, json& j);
};

inline std::istream& operator>>(std::istream& is, json& j) {
    std::string s((std::istreambuf_iterator<char>(is)), std::istreambuf_iterator<char>());
    j = json::parse(s);
    return is;
}

inline std::ostream& operator<<(std::ostream& os, const json& j) {
    os << j.dump();
    return os;
}

} // namespace nlohmann
