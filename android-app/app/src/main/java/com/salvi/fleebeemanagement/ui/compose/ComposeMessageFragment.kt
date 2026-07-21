package com.salvi.fleebeemanagement.ui.compose

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.telephony.SmsManager
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.salvi.fleebeemanagement.R
import com.salvi.fleebeemanagement.data.FleetRepository
import com.salvi.fleebeemanagement.databinding.FragmentComposeMessageBinding
import com.salvi.fleebeemanagement.model.Biker
import com.salvi.fleebeemanagement.model.MessageCategory

class ComposeMessageFragment : Fragment() {

    private var _binding: FragmentComposeMessageBinding? = null
    private val binding get() = _binding!!

    private var biker: Biker? = null
    private var selectedCategory: MessageCategory = MessageCategory.REMINDER
    private var lastSuggestedMessage: String = ""

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentComposeMessageBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val bikerId = arguments?.getString("bikerId")
        biker = bikerId?.let(FleetRepository::findBiker)

        if (biker == null) {
            toast(getString(R.string.detail_missing_biker))
            findNavController().navigateUp()
            return
        }

        selectedCategory = MessageCategory.fromName(arguments?.getString("category"))

        bindHeader(biker!!)
        setupCategorySpinner()
        setupKeyboardBehavior()
        binding.sendButton.setOnClickListener {
            dismissKeyboard()
            if (hasSmsPermission()) {
                sendCurrentMessage()
            } else {
                toast(getString(R.string.sms_permission_setup_needed))
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun bindHeader(biker: Biker) {
        binding.recipientValue.text = biker.name
        binding.phoneValue.text = biker.phoneNumber
        binding.routeValue.text = getString(
            R.string.compose_route_value,
            FleetRepository.TEST_PHONE_NUMBER
        )
    }

    private fun setupCategorySpinner() {
        val categories = MessageCategory.entries
        val spinnerAdapter = ArrayAdapter(
            requireContext(),
            android.R.layout.simple_spinner_dropdown_item,
            categories.map { it.displayName }
        )
        binding.categorySpinner.adapter = spinnerAdapter

        val selectedIndex = categories.indexOf(selectedCategory).coerceAtLeast(0)
        binding.categorySpinner.setSelection(selectedIndex)
        binding.categorySpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: AdapterView<*>?,
                view: View?,
                position: Int,
                id: Long
            ) {
                dismissKeyboard()
                selectedCategory = categories[position]
                applySuggestedMessage()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }

        applySuggestedMessage()
    }

    private fun setupKeyboardBehavior() {
        binding.root.requestFocus()
        binding.messageInput.clearFocus()
        installKeyboardDismissBehavior(binding.root)
    }

    private fun installKeyboardDismissBehavior(view: View) {
        if (view !== binding.messageInput) {
            view.setOnTouchListener { _, event ->
                if (event.action == MotionEvent.ACTION_DOWN) {
                    dismissKeyboard()
                }
                false
            }
        }

        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                installKeyboardDismissBehavior(view.getChildAt(index))
            }
        }
    }

    private fun applySuggestedMessage() {
        val currentBiker = biker ?: return
        val suggestedMessage = selectedCategory.buildSuggestedMessage(currentBiker)
        val currentText = binding.messageInput.text?.toString().orEmpty()

        if (currentText.isBlank() || currentText == lastSuggestedMessage) {
            binding.messageInput.setText(suggestedMessage)
            binding.messageInput.setSelection(suggestedMessage.length)
        }

        lastSuggestedMessage = suggestedMessage
        binding.messageInput.clearFocus()
        binding.root.requestFocus()
    }

    private fun sendCurrentMessage() {
        val currentBiker = biker ?: return
        val message = binding.messageInput.text?.toString()?.trim().orEmpty()
        if (message.isBlank()) {
            toast(getString(R.string.compose_message_blank))
            return
        }

        try {
            @Suppress("DEPRECATION")
            val smsManager = SmsManager.getDefault()
            val messageParts = smsManager.divideMessage(message)
            if (messageParts.size <= 1) {
                smsManager.sendTextMessage(
                    FleetRepository.TEST_PHONE_NUMBER,
                    null,
                    message,
                    null,
                    null
                )
            } else {
                smsManager.sendMultipartTextMessage(
                    FleetRepository.TEST_PHONE_NUMBER,
                    null,
                    messageParts,
                    null,
                    null
                )
            }
            toast(
                getString(
                    R.string.compose_send_success,
                    FleetRepository.TEST_PHONE_NUMBER,
                    currentBiker.name
                )
            )
            findNavController().navigateUp()
        } catch (error: Exception) {
            toast(getString(R.string.compose_send_failed, error.localizedMessage ?: "unknown error"))
        }
    }

    private fun hasSmsPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            requireContext(),
            Manifest.permission.SEND_SMS
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun dismissKeyboard() {
        binding.messageInput.clearFocus()
        binding.root.requestFocus()
        val inputMethodManager = requireContext().getSystemService(InputMethodManager::class.java)
        inputMethodManager?.hideSoftInputFromWindow(binding.messageInput.windowToken, 0)
    }

    private fun toast(message: String) {
        Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show()
    }
}
