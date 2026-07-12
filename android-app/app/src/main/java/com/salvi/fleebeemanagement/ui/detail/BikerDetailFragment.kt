package com.salvi.fleebeemanagement.ui.detail

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
import com.salvi.fleebeemanagement.databinding.FragmentBikerDetailBinding
import com.salvi.fleebeemanagement.model.Biker
import com.salvi.fleebeemanagement.model.MessageCategory

class BikerDetailFragment : Fragment() {

    private var _binding: FragmentBikerDetailBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentBikerDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val bikerId = arguments?.getString("bikerId")
        val biker = bikerId?.let(FleetRepository::findBiker)

        if (biker == null) {
            Toast.makeText(requireContext(), getString(R.string.detail_missing_biker), Toast.LENGTH_SHORT).show()
            findNavController().navigateUp()
            return
        }

        bindBiker(biker)

        binding.reminderButton.setOnClickListener { openComposer(biker, MessageCategory.REMINDER) }
        binding.generalButton.setOnClickListener { openComposer(biker, MessageCategory.GENERAL) }
        binding.emergencyButton.setOnClickListener { openComposer(biker, MessageCategory.EMERGENCY) }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun bindBiker(biker: Biker) {
        binding.bikerName.text = biker.name
        binding.bikerPhone.text = getString(R.string.detail_phone_format, biker.phoneNumber)
        binding.bikePlate.text = biker.bikePlate
        binding.bikeModel.text = biker.bikeModel
        binding.statusValue.text = getString(R.string.detail_status_format, biker.status)
        binding.reminderValue.text = if (biker.reminderDue) {
            getString(R.string.detail_status_due)
        } else {
            getString(R.string.detail_status_ok)
        }
        binding.alertValue.text = if (biker.urgentAlert) {
            getString(R.string.detail_alert_yes)
        } else {
            getString(R.string.detail_alert_no)
        }
        binding.routeBody.text = getString(
            R.string.detail_route_body,
            FleetRepository.TEST_PHONE_NUMBER
        )
    }

    private fun openComposer(biker: Biker, category: MessageCategory) {
        findNavController().navigate(
            R.id.action_bikerDetailFragment_to_composeMessageFragment,
            bundleOf(
                "bikerId" to biker.id,
                "category" to category.name
            )
        )
    }
}
