"""
Numina Quantum Compute Service (IBM Cloud Code Engine Optimized)
Exposes low-latency quantum optimization and simulation endpoints for numinalabs.xyz.
Supports both local Statevector simulation and real IBM QPU execution via Qiskit Runtime.
"""

import os
import json
from datetime import datetime, timezone
from aiohttp import web

from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

routes = web.RouteTableDef()

def bell_circuit() -> QuantumCircuit:
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()
    return qc

@routes.get('/healthz')
async def healthz(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "healthy",
        "service": "numina-ibm-quantum-engine",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })

@routes.get('/status')
async def status(request: web.Request) -> web.Response:
    has_ibm_token = bool(os.environ.get("IBM_QUANTUM_API_KEY") or os.environ.get("QISKIT_IBM_TOKEN"))
    return web.json_response({
        "quantum_service": "online",
        "hardware_execution_available": has_ibm_token,
        "default_mode": "local-statevector-simulation" if not has_ibm_token else "ibm-qpu-hardware",
        "cluster_state": "726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd"
    })

@routes.post('/simulate')
async def simulate(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        body = {}
    
    shots = int(body.get("shots", 256))
    qc = bell_circuit()
    sampler = StatevectorSampler(seed=42)
    result = sampler.run([qc], shots=shots).result()[0]
    
    counts = result.data.meas.get_counts()
    return web.json_response({
        "schema": "numina.ibm-quantum.v1",
        "mode": "local-simulation",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "shots": shots,
        "counts": counts,
        "qpu_executed": False
    })

@routes.post('/qpu/execute')
async def qpu_execute(request: web.Request) -> web.Response:
    token = os.environ.get("IBM_QUANTUM_API_KEY") or os.environ.get("QISKIT_IBM_TOKEN")
    if not token:
        return web.json_response({
            "error": "IBM_QUANTUM_API_KEY is not configured on this container instance",
            "fallback": "Use /simulate for statevector verification"
        }, status=400)
    
    try:
        body = await request.json()
    except Exception:
        body = {}
        
    shots = int(body.get("shots", 256))
    
    from qiskit.transpiler import generate_preset_pass_manager
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2 as Sampler
    
    service = QiskitRuntimeService(token=token, channel="ibm_quantum_platform")
    backend = service.least_busy(operational=True, simulator=False)
    
    qc = bell_circuit()
    pm = generate_preset_pass_manager(backend=backend, optimization_level=1)
    isa_qc = pm.run(qc)
    
    job = Sampler(mode=backend).run([isa_qc], shots=shots)
    job_id = job.job_id()
    
    return web.json_response({
        "schema": "numina.ibm-quantum.v1",
        "mode": "ibm-quantum-hardware",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "backend": backend.name,
        "job_id": job_id,
        "status": str(job.status()),
        "qpu_executed": True
    })

def create_app() -> web.Application:
    app = web.Application()
    app.add_routes(routes)
    return app

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    web.run_app(create_app(), port=port)
