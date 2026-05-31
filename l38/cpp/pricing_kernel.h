#pragma once

#include <vector>
#include <cmath>
#include <algorithm>
#include <atomic>

namespace pricing_kernel {

constexpr double PI = 3.14159265358979323846;
constexpr double SQRT_2PI = 2.50662827463100024161;
constexpr double INV_SQRT_2 = 0.70710678118654752440;

struct OptionParams {
    double S;
    double K;
    double T;
    double r;
    double q;
    double sigma;
    char option_type;
};

struct Greeks {
    double price;
    double delta;
    double gamma;
    double theta;
    double vega;
};

struct FDMConfig {
    double spot_min;
    double spot_max;
    int spot_points;
    int time_points;
    int scheme;
};

inline double norm_cdf(double x) {
    return 0.5 * (1.0 + erf(x * INV_SQRT_2));
}

inline double norm_pdf(double x) {
    return std::exp(-0.5 * x * x) / SQRT_2PI;
}

Greeks black_scholes(const OptionParams& params);

double calculate_implied_volatility(
    double S, double K, double T, double r, double q,
    double market_price, char option_type,
    double tol = 1e-8, int max_iter = 100);

class FDMBlackScholes {
public:
    FDMBlackScholes(const FDMConfig& config);
    
    void solve(double S0, double K, double T, double r, double q, 
               double sigma, char option_type,
               std::vector<double>& price_grid,
               std::vector<double>& delta_grid,
               std::vector<double>& gamma_grid);
    
    double get_price_at_spot(const std::vector<double>& price_grid, 
                             double S0, double S) const;

private:
    FDMConfig config_;
    std::vector<double> spot_grid_;
    double dS_;
};

class IVCalculator {
public:
    IVCalculator();
    
    void batch_calculate(
        const std::vector<double>& S,
        const std::vector<double>& K,
        const std::vector<double>& T,
        const std::vector<double>& prices,
        const std::vector<char>& types,
        double r, double q,
        std::vector<double>& output_iv,
        int num_threads = 4);
};

class RBFInterpolator {
public:
    enum KernelType {
        THIN_PLATE_SPLINE = 0,
        MULTI_QUADRIC = 1,
        GAUSSIAN = 2,
        INVERSE_MULTI_QUADRIC = 3
    };
    
    RBFInterpolator(KernelType kernel = THIN_PLATE_SPLINE, double epsilon = 1.0);
    
    void fit(const std::vector<double>& x, 
             const std::vector<double>& y,
             const std::vector<double>& z,
             const std::vector<double>& weights = std::vector<double>());
    
    void interpolate(const std::vector<double>& xi,
                     const std::vector<double>& yi,
                     std::vector<double>& zi);
    
private:
    KernelType kernel_;
    double epsilon_;
    std::vector<double> x_;
    std::vector<double> y_;
    std::vector<double> coeffs_;
    
    double kernel(double r) const;
};

}
