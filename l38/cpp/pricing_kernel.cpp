#include "pricing_kernel.h"
#include <thread>
#include <future>
#include <iostream>
#include <cstring>
#include <cmath>

namespace pricing_kernel {

Greeks black_scholes(const OptionParams& params) {
    Greeks result{0.0, 0.0, 0.0, 0.0, 0.0};
    
    double S = params.S;
    double K = params.K;
    double T = params.T;
    double r = params.r;
    double q = params.q;
    double sigma = params.sigma;
    
    if (T <= 0.0 || sigma <= 0.0 || S <= 0.0 || K <= 0.0) {
        if (params.option_type == 'C' || params.option_type == 'c') {
            result.price = std::max(0.0, S - K);
            result.delta = (S >= K) ? 1.0 : 0.0;
        } else {
            result.price = std::max(0.0, K - S);
            result.delta = (S <= K) ? -1.0 : 0.0;
        }
        return result;
    }
    
    double sqrt_T = std::sqrt(T);
    double d1 = (std::log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrt_T);
    double d2 = d1 - sigma * sqrt_T;
    
    double Nd1 = norm_cdf(d1);
    double Nd2 = norm_cdf(d2);
    double N_minus_d1 = norm_cdf(-d1);
    double N_minus_d2 = norm_cdf(-d2);
    double phid1 = norm_pdf(d1);
    
    double disc_S = std::exp(-q * T) * S;
    double disc_K = std::exp(-r * T) * K;
    
    if (params.option_type == 'C' || params.option_type == 'c') {
        result.price = disc_S * Nd1 - disc_K * Nd2;
        result.delta = std::exp(-q * T) * Nd1;
        result.theta = -std::exp(-q * T) * S * phid1 * sigma / (2.0 * sqrt_T)
                      - r * disc_K * Nd2 + q * disc_S * Nd1;
    } else {
        result.price = disc_K * N_minus_d2 - disc_S * N_minus_d1;
        result.delta = -std::exp(-q * T) * N_minus_d1;
        result.theta = -std::exp(-q * T) * S * phid1 * sigma / (2.0 * sqrt_T)
                      + r * disc_K * N_minus_d2 - q * disc_S * N_minus_d1;
    }
    
    result.gamma = std::exp(-q * T) * phid1 / (S * sigma * sqrt_T);
    result.vega = disc_S * phid1 * sqrt_T;
    
    return result;
}

double calculate_implied_volatility(
    double S, double K, double T, double r, double q,
    double market_price, char option_type,
    double tol, int max_iter) {
    
    if (market_price <= 0.0 || T <= 0.0 || S <= 0.0 || K <= 0.0) {
        return -1.0;
    }
    
    double intrinsic = (option_type == 'C' || option_type == 'c') 
        ? std::max(0.0, S - K) : std::max(0.0, K - S);
    
    if (market_price < intrinsic - 1e-6) {
        return -1.0;
    }
    
    double sigma_low = 0.01;
    double sigma_high = 5.0;
    
    OptionParams params_low{S, K, T, r, q, sigma_low, option_type};
    Greeks g_low = black_scholes(params_low);
    
    OptionParams params_high{S, K, T, r, q, sigma_high, option_type};
    Greeks g_high = black_scholes(params_high);
    
    if (g_low.price >= market_price) return sigma_low;
    if (g_high.price <= market_price) return sigma_high;
    
    double sigma = 0.2;
    for (int i = 0; i < max_iter; ++i) {
        OptionParams params{S, K, T, r, q, sigma, option_type};
        Greeks g = black_scholes(params);
        
        double price_diff = g.price - market_price;
        if (std::abs(price_diff) < tol) {
            return sigma;
        }
        
        if (g.vega < 1e-10) {
            if (price_diff > 0) {
                sigma_high = sigma;
            } else {
                sigma_low = sigma;
            }
            sigma = 0.5 * (sigma_low + sigma_high);
        } else {
            double new_sigma = sigma - price_diff / g.vega;
            new_sigma = std::max(0.01, std::min(5.0, new_sigma));
            
            OptionParams params_new{S, K, T, r, q, new_sigma, option_type};
            Greeks g_new = black_scholes(params_new);
            
            if (std::abs(g_new.price - market_price) < std::abs(price_diff)) {
                sigma = new_sigma;
            } else {
                if (price_diff > 0) {
                    sigma_high = sigma;
                } else {
                    sigma_low = sigma;
                }
                sigma = 0.5 * (sigma_low + sigma_high);
            }
        }
    }
    
    return sigma;
}

FDMBlackScholes::FDMBlackScholes(const FDMConfig& config) 
    : config_(config) {
    double S_min = config.spot_min;
    double S_max = config.spot_max;
    int N = config.spot_points;
    
    dS_ = (S_max - S_min) / N;
    spot_grid_.resize(N + 1);
    for (int i = 0; i <= N; ++i) {
        spot_grid_[i] = S_min + i * dS_;
    }
}

void FDMBlackScholes::solve(
    double S0, double K, double T, double r, double q,
    double sigma, char option_type,
    std::vector<double>& price_grid,
    std::vector<double>& delta_grid,
    std::vector<double>& gamma_grid) {
    
    int N = config_.spot_points;
    int M = config_.time_points;
    
    double dt = T / M;
    double sigma_sq = sigma * sigma;
    
    std::vector<std::vector<double>> V(N + 1, std::vector<double>(M + 1, 0.0));
    
    for (int i = 0; i <= N; ++i) {
        double S = spot_grid_[i] * S0;
        if (option_type == 'C' || option_type == 'c') {
            V[i][M] = std::max(0.0, S - K);
        } else {
            V[i][M] = std::max(0.0, K - S);
        }
    }
    
    for (int m = 0; m <= M; ++m) {
        double t = T - m * dt;
        double disc_S = std::exp(-q * t) * S0 * spot_grid_[N];
        double disc_K = std::exp(-r * t) * K;
        if (option_type == 'C' || option_type == 'c') {
            V[0][m] = 0.0;
            V[N][m] = disc_S - disc_K;
        } else {
            V[0][m] = disc_K - std::exp(-q * t) * S0 * spot_grid_[0];
            V[N][m] = 0.0;
        }
    }
    
    if (config_.scheme == 0) {
        for (int m = M; m > 0; --m) {
            for (int j = 1; j < N; ++j) {
                double Sj = spot_grid_[j];
                double alpha = 0.5 * dt * (sigma_sq * j * j - (r - q) * j);
                double beta = 1.0 - dt * (sigma_sq * j * j + r);
                double gamma = 0.5 * dt * (sigma_sq * j * j + (r - q) * j);
                
                V[j][m-1] = alpha * V[j-1][m] + beta * V[j][m] + gamma * V[j+1][m];
            }
        }
    } else {
        std::vector<double> a(N - 1), b(N - 1), c(N - 1), d(N - 1);
        
        for (int m = M; m > 0; --m) {
            for (int j = 1; j < N; ++j) {
                double jj = j;
                a[j-1] = 0.5 * dt * ((r - q) * jj - sigma_sq * jj * jj);
                b[j-1] = 1.0 + dt * (sigma_sq * jj * jj + r);
                c[j-1] = -0.5 * dt * (sigma_sq * jj * jj + (r - q) * jj);
                d[j-1] = V[j][m];
            }
            
            d[0] -= a[0] * V[0][m-1];
            d[N-2] -= c[N-2] * V[N][m-1];
            
            std::vector<double> c_prime(N - 1), d_prime(N - 1);
            c_prime[0] = c[0] / b[0];
            d_prime[0] = d[0] / b[0];
            
            for (int i = 1; i < N - 1; ++i) {
                double m_val = b[i] - a[i] * c_prime[i-1];
                c_prime[i] = c[i] / m_val;
                d_prime[i] = (d[i] - a[i] * d_prime[i-1]) / m_val;
            }
            
            V[N-1][m-1] = d_prime[N-2];
            for (int i = N - 3; i >= 0; --i) {
                V[i+1][m-1] = d_prime[i] - c_prime[i] * V[i+2][m-1];
            }
        }
    }
    
    price_grid.resize(N + 1);
    delta_grid.resize(N + 1);
    gamma_grid.resize(N + 1);
    
    for (int i = 0; i <= N; ++i) {
        price_grid[i] = V[i][0];
    }
    
    for (int i = 1; i < N; ++i) {
        delta_grid[i] = (V[i+1][0] - V[i-1][0]) / (2.0 * dS_ * S0);
        gamma_grid[i] = (V[i+1][0] - 2.0 * V[i][0] + V[i-1][0]) / (dS_ * dS_ * S0 * S0);
    }
    delta_grid[0] = (V[1][0] - V[0][0]) / (dS_ * S0);
    delta_grid[N] = (V[N][0] - V[N-1][0]) / (dS_ * S0);
    gamma_grid[0] = gamma_grid[1];
    gamma_grid[N] = gamma_grid[N-1];
}

double FDMBlackScholes::get_price_at_spot(const std::vector<double>& price_grid,
                                          double S0, double S) const {
    double normalized_S = S / S0;
    
    if (normalized_S <= spot_grid_.front()) {
        return price_grid.front();
    }
    if (normalized_S >= spot_grid_.back()) {
        return price_grid.back();
    }
    
    int idx = 0;
    while (idx < (int)spot_grid_.size() - 1 && spot_grid_[idx + 1] < normalized_S) {
        ++idx;
    }
    
    double w = (normalized_S - spot_grid_[idx]) / (spot_grid_[idx + 1] - spot_grid_[idx]);
    return (1.0 - w) * price_grid[idx] + w * price_grid[idx + 1];
}

IVCalculator::IVCalculator() {}

void IVCalculator::batch_calculate(
    const std::vector<double>& S,
    const std::vector<double>& K,
    const std::vector<double>& T,
    const std::vector<double>& prices,
    const std::vector<char>& types,
    double r, double q,
    std::vector<double>& output_iv,
    int num_threads) {
    
    int n = (int)S.size();
    output_iv.assign(n, -1.0);
    
    if (num_threads <= 1) {
        for (int i = 0; i < n; ++i) {
            output_iv[i] = calculate_implied_volatility(
                S[i], K[i], T[i], r, q, prices[i], types[i]);
        }
        return;
    }
    
    int chunk_size = (n + num_threads - 1) / num_threads;
    std::vector<std::future<void>> futures;
    
    for (int t = 0; t < num_threads; ++t) {
        int start = t * chunk_size;
        int end = std::min(start + chunk_size, n);
        
        futures.push_back(std::async(std::launch::async, [&, start, end]() {
            for (int i = start; i < end; ++i) {
                output_iv[i] = calculate_implied_volatility(
                    S[i], K[i], T[i], r, q, prices[i], types[i]);
            }
        }));
    }
    
    for (auto& f : futures) {
        f.get();
    }
}

RBFInterpolator::RBFInterpolator(KernelType kernel, double epsilon)
    : kernel_(kernel), epsilon_(epsilon) {}

double RBFInterpolator::kernel(double r) const {
    switch (kernel_) {
        case THIN_PLATE_SPLINE:
            return r * r * std::log(std::max(r, 1e-10));
        case MULTI_QUADRIC:
            return std::sqrt(r * r + epsilon_ * epsilon_);
        case GAUSSIAN:
            return std::exp(-r * r / (epsilon_ * epsilon_));
        case INVERSE_MULTI_QUADRIC:
            return 1.0 / std::sqrt(r * r + epsilon_ * epsilon_);
        default:
            return r * r * std::log(std::max(r, 1e-10));
    }
}

void RBFInterpolator::fit(const std::vector<double>& x,
                          const std::vector<double>& y,
                          const std::vector<double>& z,
                          const std::vector<double>& weights) {
    int n = (int)x.size();
    x_ = x;
    y_ = y;
    
    std::vector<std::vector<double>> A(n, std::vector<double>(n, 0.0));
    coeffs_.resize(n);
    
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j) {
            double dx = x[i] - x[j];
            double dy = y[i] - y[j];
            double r = std::sqrt(dx * dx + dy * dy);
            A[i][j] = kernel(r);
            
            if (!weights.empty() && i == j) {
                A[i][j] += 1e-8 * weights[i];
            }
        }
    }
    
    std::vector<double> b = z;
    
    for (int k = 0; k < n; ++k) {
        int max_row = k;
        double max_val = std::abs(A[k][k]);
        for (int i = k + 1; i < n; ++i) {
            if (std::abs(A[i][k]) > max_val) {
                max_val = std::abs(A[i][k]);
                max_row = i;
            }
        }
        
        if (max_row != k) {
            std::swap(A[k], A[max_row]);
            std::swap(b[k], b[max_row]);
        }
        
        for (int i = k + 1; i < n; ++i) {
            double factor = A[i][k] / A[k][k];
            for (int j = k; j < n; ++j) {
                A[i][j] -= factor * A[k][j];
            }
            b[i] -= factor * b[k];
        }
    }
    
    for (int i = n - 1; i >= 0; --i) {
        double sum = b[i];
        for (int j = i + 1; j < n; ++j) {
            sum -= A[i][j] * coeffs_[j];
        }
        coeffs_[i] = sum / A[i][i];
    }
}

void RBFInterpolator::interpolate(const std::vector<double>& xi,
                                  const std::vector<double>& yi,
                                  std::vector<double>& zi) {
    int n = (int)xi.size();
    int m = (int)x_.size();
    zi.resize(n);
    
    for (int i = 0; i < n; ++i) {
        double sum = 0.0;
        for (int j = 0; j < m; ++j) {
            double dx = xi[i] - x_[j];
            double dy = yi[i] - y_[j];
            double r = std::sqrt(dx * dx + dy * dy);
            sum += coeffs_[j] * kernel(r);
        }
        zi[i] = sum;
    }
}

}
