package com.salvi.fleebeemanagement.ui.dashboard

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.os.bundleOf
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.salvi.fleebeemanagement.R
import com.salvi.fleebeemanagement.data.FleetRepository
import com.salvi.fleebeemanagement.databinding.FragmentDashboardBinding
import com.salvi.fleebeemanagement.model.Biker
import com.salvi.fleebeemanagement.model.MessageCategory

class DashboardFragment : Fragment() {

    private var _binding: FragmentDashboardBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentDashboardBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val bikers = FleetRepository.allBikers()
        binding.totalBikersValue.text = FleetRepository.totalBikers().toString()
        binding.pendingRemindersValue.text = FleetRepository.pendingReminderCount().toString()
        binding.emergencyValue.text = FleetRepository.emergencyCount().toString()

        val adapter = BikerListAdapter(requireContext(), bikers)
        binding.bikerList.adapter = adapter
        binding.bikerList.setOnItemClickListener { _, _, position, _ ->
            openBiker(bikers[position])
        }

        binding.addBikerButton.setOnClickListener {
            toast(getString(R.string.dashboard_add_coming_soon))
        }
        binding.sendReminderButton.setOnClickListener {
            openComposer(FleetRepository.quickTarget(MessageCategory.REMINDER), MessageCategory.REMINDER)
        }
        binding.sendGeneralButton.setOnClickListener {
            openComposer(FleetRepository.quickTarget(MessageCategory.GENERAL), MessageCategory.GENERAL)
        }
        binding.sendEmergencyButton.setOnClickListener {
            openComposer(FleetRepository.quickTarget(MessageCategory.EMERGENCY), MessageCategory.EMERGENCY)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun openBiker(biker: Biker) {
        findNavController().navigate(
            R.id.action_dashboardFragment_to_bikerDetailFragment,
            bundleOf("bikerId" to biker.id)
        )
    }

    private fun openComposer(biker: Biker?, category: MessageCategory) {
        if (biker == null) {
            toast(getString(R.string.dashboard_no_biker))
            return
        }

        findNavController().navigate(
            R.id.action_dashboardFragment_to_composeMessageFragment,
            bundleOf(
                "bikerId" to biker.id,
                "category" to category.name
            )
        )
    }

    private fun toast(message: String) {
        Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show()
    }
}
