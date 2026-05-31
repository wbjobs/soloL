#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <pybind11/numpy.h>
#include "pricing_kernel.h"

namespace py = pybind11;
using namespace pricing_kernel;

PYBIND11_MODULE(pricing_kernel_cpp, m) {
    m.doc() = "High-performance option pricing kernel implemented in C++";
    
    py::class_<OptionParams>(m, "OptionParams")
        .def(py::init<>())
        .def_readwrite("S", &OptionParams::S)
        .def_readwrite("K", &OptionParams::K)
        .def_readwrite("T", &OptionParams::T)
        .def_readwrite("r", &OptionParams::r)
        .def_readwrite("q", &OptionParams::q)
        .def_readwrite("sigma", &OptionParams::sigma)
        .def_readwrite("option_type", &OptionParams::option_type);
    
    py::class_<Greeks>(m, "Greeks")
        .def(py::init<>())
        .def_readwrite("price", &Greeks::price)
        .def_readwrite("delta", &Greeks::delta)
        .def_readwrite("gamma", &Greeks::gamma)
        .def_readwrite("theta", &Greeks::theta)
        .def_readwrite("vega", &Greeks::vega);
    
    py::class_<FDMConfig>(m, "FDMConfig")
        .def(py::init<>())
        .def_readwrite("spot_min", &FDMConfig::spot_min)
        .def_readwrite("spot_max", &FDMConfig::spot_max)
        .def_readwrite("spot_points", &FDMConfig::spot_points)
        .def_readwrite("time_points", &FDMConfig::time_points)
        .def_readwrite("scheme", &FDMConfig::scheme);
    
    m.def("black_scholes", &black_scholes, 
          py::arg("params"),
          "Calculate option price and Greeks using Black-Scholes formula");
    
    m.def("calculate_implied_volatility", &calculate_implied_volatility,
          py::arg("S"), py::arg("K"), py::arg("T"), py::arg("r"), py::arg("q"),
          py::arg("market_price"), py::arg("option_type"),
          py::arg("tol") = 1e-8, py::arg("max_iter") = 100,
          "Calculate implied volatility using Newton-Raphson method");
    
    py::class_<FDMBlackScholes>(m, "FDMBlackScholes")
        .def(py::init<const FDMConfig&>(), py::arg("config"))
        .def("solve", [](FDMBlackScholes& self, double S0, double K, double T, 
                         double r, double q, double sigma, char option_type) {
            std::vector<double> price_grid, delta_grid, gamma_grid;
            self.solve(S0, K, T, r, q, sigma, option_type, price_grid, delta_grid, gamma_grid);
            return py::make_tuple(
                py::array_t<double>(price_grid.size(), price_grid.data()),
                py::array_t<double>(delta_grid.size(), delta_grid.data()),
                py::array_t<double>(gamma_grid.size(), gamma_grid.data())
            );
        }, py::arg("S0"), py::arg("K"), py::arg("T"), 
           py::arg("r"), py::arg("q"), py::arg("sigma"), py::arg("option_type"))
        .def("get_price_at_spot", &FDMBlackScholes::get_price_at_spot,
             py::arg("price_grid"), py::arg("S0"), py::arg("S"));
    
    py::class_<IVCalculator>(m, "IVCalculator")
        .def(py::init<>())
        .def("batch_calculate", [](IVCalculator& self,
                                    const std::vector<double>& S,
                                    const std::vector<double>& K,
                                    const std::vector<double>& T,
                                    const std::vector<double>& prices,
                                    const std::vector<char>& types,
                                    double r, double q,
                                    int num_threads = 4) {
            std::vector<double> output_iv;
            self.batch_calculate(S, K, T, prices, types, r, q, output_iv, num_threads);
            return py::array_t<double>(output_iv.size(), output_iv.data());
        }, py::arg("S"), py::arg("K"), py::arg("T"), py::arg("prices"),
           py::arg("types"), py::arg("r"), py::arg("q"),
           py::arg("num_threads") = 4);
    
    py::class_<RBFInterpolator>(m, "RBFInterpolator")
        .def(py::init<RBFInterpolator::KernelType, double>(),
             py::arg("kernel") = RBFInterpolator::THIN_PLATE_SPLINE,
             py::arg("epsilon") = 1.0)
        .def("fit", &RBFInterpolator::fit,
             py::arg("x"), py::arg("y"), py::arg("z"),
             py::arg("weights") = std::vector<double>())
        .def("interpolate", [](RBFInterpolator& self,
                                const std::vector<double>& xi,
                                const std::vector<double>& yi) {
            std::vector<double> zi;
            self.interpolate(xi, yi, zi);
            return py::array_t<double>(zi.size(), zi.data());
        }, py::arg("xi"), py::arg("yi"));
    
    py::enum_<RBFInterpolator::KernelType>(m, "KernelType")
        .value("THIN_PLATE_SPLINE", RBFInterpolator::THIN_PLATE_SPLINE)
        .value("MULTI_QUADRIC", RBFInterpolator::MULTI_QUADRIC)
        .value("GAUSSIAN", RBFInterpolator::GAUSSIAN)
        .value("INVERSE_MULTI_QUADRIC", RBFInterpolator::INVERSE_MULTI_QUADRIC)
        .export_values();
}
