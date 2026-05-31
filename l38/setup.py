from setuptools import setup, Extension
from setuptools.command.build_ext import build_ext
import sys
import os

class get_pybind_include(object):
    def __str__(self):
        try:
            import pybind11
            return pybind11.get_include()
        except ImportError:
            return ""

ext_modules = [
    Extension(
        'pricing_kernel_cpp',
        ['cpp/pricing_kernel.cpp', 'cpp/bindings.cpp'],
        include_dirs=[
            get_pybind_include(),
            'cpp'
        ],
        language='c++',
        extra_compile_args=['/O2', '/std:c++17'] if sys.platform == 'win32' 
                          else ['-O3', '-std=c++17', '-pthread'],
        extra_link_args=['-pthread'] if sys.platform != 'win32' else []
    ),
]

setup(
    name='pricing_kernel_cpp',
    version='1.0.0',
    author='Option Pricing System',
    description='High-performance option pricing kernel',
    ext_modules=ext_modules,
    cmdclass={'build_ext': build_ext},
    zip_safe=False,
    install_requires=['pybind11>=2.10']
)
